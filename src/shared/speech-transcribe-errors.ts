// Why: `orca speech transcribe` exists so a plugin or script can hand Orca an
// audio file it cannot read itself. A plugin must decide "this is fixable by
// turning something on" vs "this broke" WITHOUT parsing English prose, so every
// failure carries one of these stable codes plus a distinct CLI exit code.

export const SPEECH_TRANSCRIBE_ERROR_CODES = [
  /** No local speech model has ever been downloaded on this Orca. */
  'voice_not_configured',
  /** The requested model id is not in the speech catalog. */
  'model_unknown',
  /** The model exists but file transcription cannot use it (cloud provider). */
  'model_not_supported',
  /** The model is in the catalog but not downloaded yet; `modelId` says which. */
  'model_not_downloaded',
  /** Only English-only models are downloaded while another language was asked for. */
  'model_language_mismatch',
  /** No audio decoder (ffmpeg) was found, so the container cannot be read. */
  'decoder_missing',
  /** The path does not exist, or is not a regular file. */
  'file_not_found',
  /** The file is larger than the accepted maximum. */
  'file_too_large',
  /** The decoded audio is longer than the accepted maximum. */
  'audio_too_long',
  /** A dictation or another transcription owns the speech worker right now. */
  'speech_busy',
  /** Decoding or recognition was attempted and genuinely failed. */
  'transcribe_failed'
] as const

export type SpeechTranscribeErrorCode = (typeof SPEECH_TRANSCRIBE_ERROR_CODES)[number]

/** Machine-readable recovery hints attached to a failure's `error.data`. */
export type SpeechTranscribeErrorData = {
  /** The model the caller asked for, or the one that has to be downloaded. */
  modelId?: string
  /** The multilingual model Orca recommends downloading. */
  recommendedModelId?: string
  /** Local models that are downloaded and ready right now. */
  readyModelIds?: string[]
  /** The `--language` value that could not be served. */
  requestedLanguage?: string
  maxBytes?: number
  sizeBytes?: number
  maxDurationSeconds?: number
  /** Human-facing recovery steps; the CLI prints these under the message. */
  nextSteps?: string[]
}

// Why: one exit code per fixable cause lets a plugin branch on `$?` alone.
// Anything not listed here (runtime_unavailable, invalid_argument, transport
// failures) stays on 1 — "Orca is not running" needs a different fix than
// "transcription broke", so it must not be folded into transcribe_failed.
export const SPEECH_TRANSCRIBE_EXIT_CODES: Readonly<Record<SpeechTranscribeErrorCode, number>> = {
  model_unknown: 2,
  model_not_supported: 2,
  voice_not_configured: 3,
  model_not_downloaded: 4,
  model_language_mismatch: 5,
  decoder_missing: 6,
  file_not_found: 7,
  file_too_large: 8,
  audio_too_long: 9,
  speech_busy: 10,
  transcribe_failed: 11
}

export const SPEECH_TRANSCRIBE_GENERIC_EXIT_CODE = 1

export function isSpeechTranscribeErrorCode(value: unknown): value is SpeechTranscribeErrorCode {
  return (
    typeof value === 'string' &&
    (SPEECH_TRANSCRIBE_ERROR_CODES as readonly string[]).includes(value)
  )
}

export function speechTranscribeExitCode(code: unknown): number {
  return isSpeechTranscribeErrorCode(code)
    ? SPEECH_TRANSCRIBE_EXIT_CODES[code]
    : SPEECH_TRANSCRIBE_GENERIC_EXIT_CODE
}
