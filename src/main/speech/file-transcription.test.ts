import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SpeechModelState } from '../../shared/speech-types'
import type { SttEventSink } from './stt-service'
import {
  MAX_AUDIO_FILE_BYTES,
  transcribeSpeechFile,
  type SpeechAudioDecoder,
  type SpeechFileTranscriptionDeps
} from './file-transcription'

const MULTILINGUAL = 'parakeet-tdt-0.6b-v3-int8'
const ENGLISH_ONLY = 'parakeet-tdt-0.6b-v2-int8'
const SAMPLE_RATE = 16_000

function audioFile(bytes = 1024): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-transcribe-'))
  const path = join(dir, 'note.opus')
  writeFileSync(path, Buffer.alloc(bytes))
  return path
}

function stubDecoder(seconds: number): SpeechAudioDecoder {
  return {
    resolvePath: () => '/fake/ffmpeg',
    decode: async ({ sampleRate }) => ({
      samples: new Float32Array(Math.round(sampleRate * seconds)).fill(0.1),
      sampleRate,
      durationSeconds: seconds
    })
  }
}

type SttStub = {
  service: SpeechFileTranscriptionDeps['sttService']
  feeds: number[]
  stopCalls: number
  sink: SttEventSink | null
}

function sttStub(
  options: { segments?: string[]; error?: string; startError?: Error } = {}
): SttStub {
  const stub: SttStub = {
    feeds: [],
    stopCalls: 0,
    sink: null,
    service: {
      startDictation: async (_modelId, sink) => {
        if (options.startError) {
          throw options.startError
        }
        stub.sink = sink
      },
      feedAudio: (samples) => {
        stub.feeds.push(samples.length)
      },
      stopDictation: async () => {
        stub.stopCalls += 1
        for (const segment of options.segments ?? []) {
          stub.sink?.({ type: 'final', text: segment })
        }
        if (options.error) {
          stub.sink?.({ type: 'error', error: options.error })
        }
      }
    }
  }
  return stub
}

function deps(
  overrides: {
    states?: SpeechModelState[]
    stt?: SttStub
    decoderSeconds?: number
    preferredModelId?: string
  } = {}
): SpeechFileTranscriptionDeps & { stt: SttStub } {
  const stt = overrides.stt ?? sttStub({ segments: ['hola mundo'] })
  return {
    stt,
    modelManager: {
      getModelStates: async () => overrides.states ?? [{ id: MULTILINGUAL, status: 'ready' }]
    },
    sttService: stt.service,
    decoder: stubDecoder(overrides.decoderSeconds ?? 2),
    ...(overrides.preferredModelId ? { preferredModelId: overrides.preferredModelId } : {})
  }
}

describe('transcribeSpeechFile', () => {
  it('transcribes a file with the multilingual model and reports what it used', async () => {
    const dependencies = deps()
    const result = await transcribeSpeechFile(dependencies, { filePath: audioFile() })

    expect(result).toMatchObject({
      text: 'hola mundo',
      segments: ['hola mundo'],
      modelId: MULTILINGUAL,
      language: 'auto',
      durationSeconds: 2
    })
    expect(dependencies.stt.stopCalls).toBe(1)
  })

  it('feeds the audio in bounded windows instead of one unbounded buffer', async () => {
    const dependencies = deps({ decoderSeconds: 45 })
    await transcribeSpeechFile(dependencies, { filePath: audioFile() })

    expect(dependencies.stt.feeds).toEqual([30 * SAMPLE_RATE, 15 * SAMPLE_RATE])
  })

  it('rejects a relative path and a missing file as file_not_found', async () => {
    await expect(transcribeSpeechFile(deps(), { filePath: 'note.opus' })).rejects.toMatchObject({
      code: 'file_not_found'
    })
    await expect(
      transcribeSpeechFile(deps(), { filePath: join(tmpdir(), 'orca-no-such-note.opus') })
    ).rejects.toMatchObject({ code: 'file_not_found' })
  })

  it('refuses an oversized file before decoding it', async () => {
    const path = audioFile()
    truncateSync(path, MAX_AUDIO_FILE_BYTES + 1)
    const dependencies = deps()
    const decode = vi.spyOn(dependencies.decoder as SpeechAudioDecoder, 'decode')

    await expect(transcribeSpeechFile(dependencies, { filePath: path })).rejects.toMatchObject({
      code: 'file_too_large',
      data: { maxBytes: MAX_AUDIO_FILE_BYTES }
    })
    expect(decode).not.toHaveBeenCalled()
  })

  it('names the model to download instead of downloading it', async () => {
    const dependencies = deps({ states: [] })
    const start = vi.spyOn(dependencies.sttService, 'startDictation')

    await expect(
      transcribeSpeechFile(dependencies, { filePath: audioFile() })
    ).rejects.toMatchObject({
      code: 'voice_not_configured',
      data: { recommendedModelId: MULTILINGUAL }
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('reports model_language_mismatch when only an English-only model is ready', async () => {
    await expect(
      transcribeSpeechFile(deps({ states: [{ id: ENGLISH_ONLY, status: 'ready' }] }), {
        filePath: audioFile()
      })
    ).rejects.toMatchObject({
      code: 'model_language_mismatch',
      data: { readyModelIds: [ENGLISH_ONLY] }
    })
  })

  it('maps an active dictation to speech_busy', async () => {
    const stt = sttStub({ startError: new Error('dictation_already_active') })
    await expect(
      transcribeSpeechFile(deps({ stt }), { filePath: audioFile() })
    ).rejects.toMatchObject({ code: 'speech_busy' })
  })

  it('surfaces a worker error as transcribe_failed and still releases the worker', async () => {
    const stt = sttStub({ error: 'recognizer blew up' })
    const dependencies = deps({ stt })

    await expect(
      transcribeSpeechFile(dependencies, { filePath: audioFile() })
    ).rejects.toMatchObject({ code: 'transcribe_failed' })
    expect(stt.stopCalls).toBe(1)
  })

  it('stops the worker and codes the failure when feeding audio throws', async () => {
    const stt = sttStub({ segments: [] })
    stt.service.feedAudio = () => {
      throw new Error('worker gone')
    }

    await expect(
      transcribeSpeechFile(deps({ stt }), { filePath: audioFile() })
    ).rejects.toMatchObject({ code: 'transcribe_failed' })
    expect(stt.stopCalls).toBe(1)
  })

  it('maps an owner mismatch mid-feed to speech_busy', async () => {
    const stt = sttStub({ segments: [] })
    stt.service.feedAudio = () => {
      throw new Error('dictation_owner_mismatch')
    }

    await expect(
      transcribeSpeechFile(deps({ stt }), { filePath: audioFile() })
    ).rejects.toMatchObject({ code: 'speech_busy' })
    expect(stt.stopCalls).toBe(1)
  })

  it('codes a stop failure that cost the transcript', async () => {
    const stt = sttStub({ segments: [] })
    stt.service.stopDictation = async () => {
      stt.stopCalls += 1
      throw new Error('stop timed out')
    }

    await expect(
      transcribeSpeechFile(deps({ stt }), { filePath: audioFile() })
    ).rejects.toMatchObject({ code: 'transcribe_failed' })
    expect(stt.stopCalls).toBe(1)
  })

  it('normalizes the requested language and applies it as a model constraint', async () => {
    const result = await transcribeSpeechFile(deps(), {
      filePath: audioFile(),
      language: 'es-419'
    })
    expect(result.language).toBe('es')
  })
})
