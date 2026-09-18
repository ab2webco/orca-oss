import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDecodeArgs,
  decodeAudioFile,
  pcmBufferToFloat32,
  requireAudioDecoderPath,
  resolveAudioDecoderPath,
  FFMPEG_PATH_ENV
} from './file-transcription-decode'
import { SpeechTranscribeError } from './file-transcription-error'

const SAMPLE_RATE = 16_000

function writeWav(dir: string, seconds: number): string {
  const sampleCount = SAMPLE_RATE * seconds
  const dataBytes = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVEfmt ', 8, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < sampleCount; i += 1) {
    buffer.writeInt16LE(
      Math.round(Math.sin((i / SAMPLE_RATE) * 2 * Math.PI * 440) * 8000),
      44 + i * 2
    )
  }
  const path = join(dir, 'tone.wav')
  writeFileSync(path, buffer)
  return path
}

describe('buildDecodeArgs', () => {
  it('passes the path as one argv entry so shell metacharacters stay inert', () => {
    const args = buildDecodeArgs('/tmp/a b;$(whoami).opus', SAMPLE_RATE)
    expect(args).toContain('/tmp/a b;$(whoami).opus')
    expect(args.join(' ')).not.toContain('sh -c')
    expect(args).toEqual(expect.arrayContaining(['-nostdin', '-ac', '1', '-ar', '16000', 's16le']))
  })
})

describe('pcmBufferToFloat32', () => {
  it('scales signed 16-bit little-endian samples into [-1, 1)', () => {
    const buffer = Buffer.alloc(6)
    buffer.writeInt16LE(0, 0)
    buffer.writeInt16LE(16_384, 2)
    buffer.writeInt16LE(-32_768, 4)
    expect([...pcmBufferToFloat32(buffer)]).toEqual([0, 0.5, -1])
  })

  it('ignores a trailing odd byte instead of reading past the buffer', () => {
    expect(pcmBufferToFloat32(Buffer.from([0x00, 0x40, 0x7f])).length).toBe(1)
  })
})

describe('resolveAudioDecoderPath', () => {
  it('uses an executable override and rejects one that does not resolve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-decoder-'))
    const fake = join(dir, 'ffmpeg')
    writeFileSync(fake, '#!/bin/sh\nexit 0\n')
    chmodSync(fake, 0o755)
    expect(resolveAudioDecoderPath({ [FFMPEG_PATH_ENV]: fake, PATH: '' })).toBe(fake)
    expect(resolveAudioDecoderPath({ [FFMPEG_PATH_ENV]: join(dir, 'missing'), PATH: '' })).toBe(
      null
    )
  })

  it('finds the binary on PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-decoder-path-'))
    const fake = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    writeFileSync(fake, '')
    chmodSync(fake, 0o755)
    expect(resolveAudioDecoderPath({ PATH: dir })).toBe(fake)
  })

  it('reports decoder_missing with install steps when nothing is installed', () => {
    // A nonexistent override is the only way to prove "not installed" without
    // depending on the host's real PATH and package prefixes.
    expect(() =>
      requireAudioDecoderPath({ [FFMPEG_PATH_ENV]: join(tmpdir(), 'orca-no-such-ffmpeg') })
    ).toThrow(SpeechTranscribeError)
    try {
      requireAudioDecoderPath({ [FFMPEG_PATH_ENV]: join(tmpdir(), 'orca-no-such-ffmpeg') })
    } catch (error) {
      expect(error).toMatchObject({ code: 'decoder_missing' })
      expect((error as SpeechTranscribeError).data.nextSteps?.length).toBeGreaterThan(0)
    }
  })
})

const ffmpegPath = resolveAudioDecoderPath()

describe.skipIf(ffmpegPath === null)('decodeAudioFile with the real decoder', () => {
  it('decodes a wav file to mono PCM at the model sample rate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-decode-'))
    const decoded = await decodeAudioFile({
      filePath: writeWav(dir, 1),
      sampleRate: SAMPLE_RATE,
      maxDurationSeconds: 60,
      decoderPath: ffmpegPath as string
    })
    expect(decoded.sampleRate).toBe(SAMPLE_RATE)
    expect(decoded.durationSeconds).toBeCloseTo(1, 1)
    expect(decoded.samples.some((sample) => Math.abs(sample) > 0.1)).toBe(true)
  })

  it('stops at the duration cap instead of buffering the whole file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-decode-cap-'))
    await expect(
      decodeAudioFile({
        filePath: writeWav(dir, 3),
        sampleRate: SAMPLE_RATE,
        maxDurationSeconds: 1,
        decoderPath: ffmpegPath as string
      })
    ).rejects.toMatchObject({ code: 'audio_too_long', data: { maxDurationSeconds: 1 } })
  })

  it('reports transcribe_failed without echoing decoder output for a non-audio file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-decode-bad-'))
    const path = join(dir, 'not-audio.opus')
    writeFileSync(path, 'this is not audio')
    await expect(
      decodeAudioFile({
        filePath: path,
        sampleRate: SAMPLE_RATE,
        maxDurationSeconds: 60,
        decoderPath: ffmpegPath as string
      })
    ).rejects.toMatchObject({ code: 'transcribe_failed' })
  })
})
