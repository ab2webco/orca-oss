import { RuntimeClientError } from '../runtime-client'

// Why these: the call may or may not have reached the runtime; anything else is an answer, not a blip.
const UNKNOWN_OUTCOME_CODES: ReadonlySet<string> = new Set([
  'runtime_unavailable',
  'remote_runtime_unavailable',
  'runtime_timeout',
  'invalid_runtime_response'
])

/** The runtime answered and refused, so the launch surely started nothing. */
export const isLaunchRefusal = (error: unknown): boolean =>
  error instanceof RuntimeClientError && !UNKNOWN_OUTCOME_CODES.has(error.code)

/** Pauses before the 2nd and 3rd attempt; a launch is retried at most twice. */
export const GAME_LAUNCH_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000]

function retryRequestIdOf(error: unknown): string | null {
  if (!(error instanceof RuntimeClientError) || !UNKNOWN_OUTCOME_CODES.has(error.code)) {
    return null
  }
  const data = error.data
  const id =
    typeof data === 'object' && data !== null && 'orchestrationRequestId' in data
      ? data.orchestrationRequestId
      : undefined
  return typeof id === 'string' && id !== '' ? id : null
}

/**
 * Runs an orchestration mutation, retrying a network failure a bounded number of times.
 * Why the request id: re-sent with it, the runtime answers the first attempt's outcome instead
 * of starting a second member.
 */
export async function callWithLaunchRetry<T>(
  call: (requestId: string | undefined) => Promise<T>,
  delaysMs: readonly number[] = GAME_LAUNCH_RETRY_DELAYS_MS
): Promise<T> {
  let requestId: string | undefined
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call(requestId)
    } catch (error) {
      const retryId = retryRequestIdOf(error)
      if (retryId === null || attempt >= delaysMs.length) {
        throw error
      }
      requestId = retryId
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
    }
  }
}
