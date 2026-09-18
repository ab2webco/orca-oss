import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { RuntimeSpeechFileTranscription } from '../../shared/runtime-types'
import type { SpeechModelState } from '../../shared/speech-types'
import type { SttEvent, SttEventSink } from './stt-service'
import { OFFLINE_DECODE_CHUNK_SECONDS } from './stt-offline-audio-chunker'
import { SpeechTranscribeError } from './file-transcription-error'
import {
  audioFileExists,
  decodeAudioFile,
  requireAudioDecoderPath,
  type DecodeAudioFileOptions,
  type DecodedAudio
} from './file-transcription-decode'
import {
  AUTO_LANGUAGE,
  normalizeLanguageTag,
  recommendedMultilingualModelId,
  selectFileTranscriptionModel
} from './file-transcription-model'

/** A 2 GB file must never reach the decoder, and a plugin needs the limit to be
 *  a number it can check, not a crash. 200 MiB covers voice notes, meeting
 *  recordings and ticket attachments with room to spare. */
export const MAX_AUDIO_FILE_BYTES = 200 * 1024 * 1024

/** Decoded-audio ceiling. Chosen together with the CLI's RPC timeout: int8
 *  Parakeet decodes well under real time on CPU, so 20 minutes of audio stays
 *  inside the CLI's 15-minute call budget, and the PCM buffer stays ≈77 MB. */
export const MAX_AUDIO_DURATION_SECONDS = 20 * 60

/** Owner string for the shared SttService, so a file transcription and a
 *  desktop dictation cannot silently share one worker session. */
export const FILE_TRANSCRIPTION_OWNER = 'file-transcription'

type SpeechModelManagerLike = {
  getModelStates(): Promise<SpeechModelState[]>
}

type SttServiceLike = {
  startDictation(
    modelId: string,
    sink: SttEventSink,
    hotwordsFilePath?: string,
    owner?: string
  ): Promise<void>
  feedAudio(samples: Float32Array, sampleRate: number, owner?: string): void
  stopDictation(owner?: string, options?: { cancelStarting?: boolean }): Promise<void>
}

/** Decoding seam: ffmpeg in production, a stub in tests. */
export type SpeechAudioDecoder = {
  resolvePath(env: NodeJS.ProcessEnv): string
  decode(options: DecodeAudioFileOptions): Promise<DecodedAudio>
}

const FFMPEG_DECODER: SpeechAudioDecoder = {
  resolvePath: requireAudioDecoderPath,
  decode: decodeAudioFile
}

export type SpeechFileTranscriptionDeps = {
  modelManager: SpeechModelManagerLike
  sttService: SttServiceLike
  /** The model selected in Settings → Voice; used only when it serves the language. */
  preferredModelId?: string
  env?: NodeJS.ProcessEnv
  decoder?: SpeechAudioDecoder
}

export type SpeechFileTranscriptionParams = {
  /** Absolute path; the CLI resolves it against the caller's cwd. */
  filePath: string
  modelId?: string
  language?: string
}

export type SpeechFileTranscriptionResult = RuntimeSpeechFileTranscription

function assertReadableAudioFile(filePath: string): number {
  if (!isAbsolute(filePath)) {
    throw new SpeechTranscribeError('file_not_found', 'The audio path must be absolute.')
  }
  if (!audioFileExists(filePath)) {
    throw new SpeechTranscribeError('file_not_found', 'No audio file at the given path.')
  }
  const sizeBytes = statSync(filePath).size
  if (sizeBytes > MAX_AUDIO_FILE_BYTES) {
    throw new SpeechTranscribeError(
      'file_too_large',
      `The audio file is larger than the ${Math.round(MAX_AUDIO_FILE_BYTES / (1024 * 1024))} MB limit.`,
      { sizeBytes, maxBytes: MAX_AUDIO_FILE_BYTES }
    )
  }
  return sizeBytes
}

// Every SttService failure must arrive at the CLI with a code: an uncoded
// Error would reach the RPC boundary as runtime_error and exit 1, which reads
// as "this broke" for what is often "something else is dictating".
function mapSpeechEngineError(error: unknown, modelId: string): SpeechTranscribeError {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'dictation_already_active' || message === 'dictation_owner_mismatch') {
    return new SpeechTranscribeError(
      'speech_busy',
      'The speech engine is busy with a dictation right now.',
      { nextSteps: ['Stop the active dictation and run the command again'] }
    )
  }
  // Why: the model was ready when it was selected, so a late "not ready" means
  // it was deleted or is mid-download — still a download problem, not a crash.
  if (message.startsWith('Model not ready')) {
    return new SpeechTranscribeError(
      'model_not_downloaded',
      `Speech model "${modelId}" is not ready to use.`,
      {
        modelId,
        recommendedModelId: recommendedMultilingualModelId(),
        nextSteps: [`Download it: orca speech models download ${modelId}`]
      }
    )
  }
  return new SpeechTranscribeError('transcribe_failed', `The speech engine failed: ${message}`)
}

/** Transcribes one audio file by reusing the dictation worker and the models
 *  that are already downloaded. Never downloads a model on its own: that is
 *  hundreds of MB nobody asked for from a CLI call. */
export async function transcribeSpeechFile(
  deps: SpeechFileTranscriptionDeps,
  params: SpeechFileTranscriptionParams
): Promise<SpeechFileTranscriptionResult> {
  const sizeBytes = assertReadableAudioFile(params.filePath)
  const language = normalizeLanguageTag(params.language)

  const states = await deps.modelManager.getModelStates()
  const selection = selectFileTranscriptionModel({
    states,
    language,
    ...(params.modelId ? { requestedModelId: params.modelId } : {}),
    ...(deps.preferredModelId ? { preferredModelId: deps.preferredModelId } : {})
  })
  if (!selection.ok) {
    throw new SpeechTranscribeError(selection.code, selection.message, selection.data)
  }
  const manifest = selection.manifest

  const decoder = deps.decoder ?? FFMPEG_DECODER
  const decoderPath = decoder.resolvePath(deps.env ?? process.env)
  const decoded = await decoder.decode({
    filePath: params.filePath,
    sampleRate: manifest.sampleRate,
    maxDurationSeconds: MAX_AUDIO_DURATION_SECONDS,
    decoderPath
  })

  const segments: string[] = []
  let workerError: string | null = null
  const sink: SttEventSink = (event: SttEvent) => {
    if (event.type === 'final' && event.text) {
      segments.push(event.text)
    } else if (event.type === 'error' && event.error) {
      workerError ??= event.error
    }
  }

  try {
    await deps.sttService.startDictation(manifest.id, sink, undefined, FILE_TRANSCRIPTION_OWNER)
  } catch (error) {
    throw mapSpeechEngineError(error, manifest.id)
  }

  let feedError: unknown = null
  try {
    const sliceSamples = Math.max(1, Math.round(OFFLINE_DECODE_CHUNK_SECONDS * decoded.sampleRate))
    for (let offset = 0; offset < decoded.samples.length; offset += sliceSamples) {
      // slice() copies: feedAudio transfers the buffer to the worker, so each
      // window must own its memory or the next slice reads a detached buffer.
      const slice = decoded.samples.slice(offset, offset + sliceSamples)
      deps.sttService.feedAudio(slice, decoded.sampleRate, FILE_TRANSCRIPTION_OWNER)
    }
  } catch (error) {
    feedError = error
  }

  // Why: stop flushes the tail window and releases the owner, so it must run
  // even after a feed failure — and its own failure must not mask that one.
  let stopError: unknown = null
  try {
    await deps.sttService.stopDictation(FILE_TRANSCRIPTION_OWNER)
  } catch (error) {
    stopError = error
  }
  if (feedError) {
    throw mapSpeechEngineError(feedError, manifest.id)
  }

  const text = segments.join(' ').replace(/\s+/g, ' ').trim()
  if (text.length === 0) {
    // A stop failure only matters when it cost us the transcript.
    if (stopError) {
      throw mapSpeechEngineError(stopError, manifest.id)
    }
    // The sink closure writes workerError, so narrowing needs a local copy.
    const failureDetail = workerError ?? ''
    throw new SpeechTranscribeError(
      'transcribe_failed',
      failureDetail.length > 0
        ? `Transcription failed: ${failureDetail}`
        : 'Transcription produced no text for this audio.',
      {
        modelId: manifest.id,
        ...(language === AUTO_LANGUAGE ? {} : { requestedLanguage: language })
      }
    )
  }

  return {
    text,
    segments,
    modelId: manifest.id,
    language,
    durationSeconds: Math.round(decoded.durationSeconds * 100) / 100,
    sizeBytes
  }
}
