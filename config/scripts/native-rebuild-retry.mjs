// Bounded retry for native rebuild commands. node-gyp downloads Node headers
// with no retry of its own, so one TLS reset fails a whole CI job with no
// assertion behind it.

export const NATIVE_REBUILD_ATTEMPTS = 3
export const RETRY_BACKOFF_MS = 5_000

// Why synchronous: the callers are sequential CI gates, and going async would
// force the whole chain async for no behavioural gain.
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Runs `spawn` until it reports success or `attempts` is exhausted, sleeping
 * `attempt * backoffMs` between tries. Returns the last result so the caller
 * owns how a final failure is reported.
 */
export function runWithRetries({
  spawn,
  describe,
  attempts = 1,
  backoffMs = RETRY_BACKOFF_MS,
  sleep = sleepSync,
  warn = console.warn
}) {
  for (let attempt = 1; ; attempt += 1) {
    const result = spawn()
    if (!result.error && result.status === 0) {
      return { ok: true, result, attempts: attempt }
    }
    if (attempt >= attempts) {
      return { ok: false, result, attempts: attempt }
    }
    const delayMs = attempt * backoffMs
    warn(
      `[native-runtime] ${describe} failed (attempt ${attempt}/${attempts}); retrying in ${delayMs}ms.`
    )
    sleep(delayMs)
  }
}
