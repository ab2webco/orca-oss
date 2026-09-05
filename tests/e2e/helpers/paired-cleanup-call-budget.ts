import { withTimeout } from './electron-process-shutdown'

export const PAIRED_CLEANUP_CALL_TIMEOUT_MS = 5_000

/**
 * Settle one paired-client cleanup RPC within a fixed budget, swallowing its outcome.
 *
 * A dead paired transport queues `runtimeEnvironments.call` behind a request that never
 * settles, so `.catch()` alone saves nothing: an unbounded cleanup outlives the test's own
 * budget and the run reports a bare Playwright timeout instead of the assertion that failed.
 */
export async function settlePairedCleanupCall(
  call: Promise<unknown>,
  timeoutMs: number = PAIRED_CLEANUP_CALL_TIMEOUT_MS
): Promise<void> {
  await withTimeout(call, timeoutMs, 'Timed out on a paired-client cleanup call').catch(
    () => undefined
  )
}
