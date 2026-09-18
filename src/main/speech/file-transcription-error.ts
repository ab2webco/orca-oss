import type {
  SpeechTranscribeErrorCode,
  SpeechTranscribeErrorData
} from '../../shared/speech-transcribe-errors'

/** Carries a stable `code` (and machine-readable recovery data) across the RPC
 *  boundary: rpc/errors.ts forwards `.code`/`.data` verbatim, so a plugin never
 *  has to parse the English message to know what to fix. */
export class SpeechTranscribeError extends Error {
  readonly code: SpeechTranscribeErrorCode
  readonly data: SpeechTranscribeErrorData

  constructor(
    code: SpeechTranscribeErrorCode,
    message: string,
    data: SpeechTranscribeErrorData = {}
  ) {
    super(message)
    this.name = 'SpeechTranscribeError'
    this.code = code
    this.data = data
  }
}
