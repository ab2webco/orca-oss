import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { SpeechTranscribeError } from './file-transcription-error'

/** Set this to point Orca at a specific ffmpeg build. */
export const FFMPEG_PATH_ENV = 'ORCA_FFMPEG_PATH'

const FFMPEG_BINARY = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

// Why: PATH is usually empty for a GUI app launched from Finder/Dock, so the
// usual package-manager prefixes are probed too before giving up.
const FALLBACK_FFMPEG_DIRS =
  process.platform === 'win32'
    ? ['C:\\ffmpeg\\bin', 'C:\\Program Files\\ffmpeg\\bin']
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/opt/local/bin', '/snap/bin']

const PCM_BYTES_PER_SAMPLE = 2
const INT16_FULL_SCALE = 32768

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) {
      return false
    }
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Returns the ffmpeg binary to decode with, or null when none is installed. */
export function resolveAudioDecoderPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env[FFMPEG_PATH_ENV]?.trim()
  if (override) {
    // An override that does not resolve is a configuration mistake worth
    // surfacing as "no decoder" rather than silently falling back to PATH.
    return isAbsolute(override) && isExecutableFile(override) ? override : null
  }
  const pathDirs = (env.PATH ?? '').split(delimiter).filter((dir) => dir.length > 0)
  for (const dir of [...pathDirs, ...FALLBACK_FFMPEG_DIRS]) {
    const candidate = join(dir, FFMPEG_BINARY)
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }
  return null
}

export function requireAudioDecoderPath(env: NodeJS.ProcessEnv = process.env): string {
  const decoderPath = resolveAudioDecoderPath(env)
  if (!decoderPath) {
    throw new SpeechTranscribeError(
      'decoder_missing',
      'No audio decoder found: ffmpeg is required to read compressed audio (.opus, .m4a, .mp3).',
      {
        nextSteps: [
          process.platform === 'darwin'
            ? 'Install it: brew install ffmpeg'
            : 'Install ffmpeg with your package manager',
          `Or point Orca at an existing build with ${FFMPEG_PATH_ENV}=/path/to/ffmpeg`
        ]
      }
    )
  }
  return decoderPath
}

/** ffmpeg argv that turns any supported container into raw mono PCM at the
 *  model's sample rate. Passed to spawn() as an array — never a shell string —
 *  so a path containing `;` or `$(...)` is inert. */
export function buildDecodeArgs(filePath: string, sampleRate: number): string[] {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-vn',
    '-map',
    'a:0',
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-f',
    's16le',
    '-'
  ]
}

export function pcmBufferToFloat32(buffer: Buffer): Float32Array {
  const sampleCount = Math.floor(buffer.length / PCM_BYTES_PER_SAMPLE)
  const samples = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = buffer.readInt16LE(i * PCM_BYTES_PER_SAMPLE) / INT16_FULL_SCALE
  }
  return samples
}

export type DecodedAudio = {
  samples: Float32Array
  sampleRate: number
  durationSeconds: number
}

export type DecodeAudioFileOptions = {
  filePath: string
  sampleRate: number
  maxDurationSeconds: number
  decoderPath: string
}

/** Decodes the whole file to mono PCM. Bounded by `maxDurationSeconds`: the
 *  decoder is killed as soon as it produces more audio than that, so the
 *  in-memory buffer can never exceed the documented cap. */
export async function decodeAudioFile(options: DecodeAudioFileOptions): Promise<DecodedAudio> {
  const { filePath, sampleRate, maxDurationSeconds, decoderPath } = options
  const maxBytes = Math.ceil(maxDurationSeconds * sampleRate) * PCM_BYTES_PER_SAMPLE

  return new Promise<DecodedAudio>((resolve, reject) => {
    const child = spawn(decoderPath, buildDecodeArgs(filePath, sampleRate), {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false
    let exceededDuration = false

    const fail = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      child.kill('SIGKILL')
      reject(error)
    }

    // Why: ffmpeg's stderr can quote file metadata (titles, comments), and the
    // error surface must not leak file content — only the exit status is kept.
    child.stderr?.resume()

    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) {
        return
      }
      chunks.push(chunk)
      totalBytes += chunk.length
      if (totalBytes > maxBytes) {
        exceededDuration = true
        child.kill('SIGKILL')
      }
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      fail(
        error.code === 'ENOENT'
          ? new SpeechTranscribeError(
              'decoder_missing',
              'The configured audio decoder could not be executed.',
              { nextSteps: [`Check ${FFMPEG_PATH_ENV} or reinstall ffmpeg`] }
            )
          : new SpeechTranscribeError('transcribe_failed', 'The audio decoder failed to start.')
      )
    })

    child.on('close', (code) => {
      if (settled) {
        return
      }
      settled = true
      if (exceededDuration) {
        reject(
          new SpeechTranscribeError(
            'audio_too_long',
            `The audio is longer than the ${Math.round(maxDurationSeconds / 60)} minute limit for a single transcription.`,
            { maxDurationSeconds }
          )
        )
        return
      }
      if (code !== 0) {
        reject(
          new SpeechTranscribeError(
            'transcribe_failed',
            `Could not decode the audio file (decoder exit code ${code ?? 'unknown'}).`,
            { nextSteps: ['Check that the file is an audio file ffmpeg can read'] }
          )
        )
        return
      }
      const samples = pcmBufferToFloat32(Buffer.concat(chunks))
      if (samples.length === 0) {
        reject(
          new SpeechTranscribeError('transcribe_failed', 'The file contains no decodable audio.')
        )
        return
      }
      resolve({ samples, sampleRate, durationSeconds: samples.length / sampleRate })
    })
  })
}

export function audioFileExists(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile()
  } catch {
    return false
  }
}
