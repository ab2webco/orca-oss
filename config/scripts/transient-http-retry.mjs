// Bounded retry for CLI calls whose failure is a transient HTTP 5xx: `gh api` in the
// ci failure class job and `docker build` pulling from a registry (ORCA-659). One
// GitHub 502 or Docker Hub 500 otherwise turns a PR red with no test behind it.
import { sleepSync } from './native-rebuild-retry.mjs'

// Why 5/15/45: growing waits so all attempts don't land in one outage window, and
// 65 s in total stays far inside the 10 minute cap of the jobs that call this.
export const TRANSIENT_RETRY_BACKOFF_MS = [5_000, 15_000, 45_000]

// gh: `(HTTP 502)`. docker/buildkit: `unexpected status code <url>: 500 Internal Server Error`
// and `unexpected status from GET request to <url>: 503 Service Unavailable`.
const STATUS_PATTERNS = [/\bHTTP (\d{3})\b/g, /unexpected status[^\n]*?: (\d{3}) [A-Z]/g]
const DROPPED_CONNECTION =
  /connection reset by peer|i\/o timeout|TLS handshake timeout|unexpected EOF|connection refused/i

export function lastHttpStatus(text) {
  let last = null
  for (const pattern of STATUS_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (last === null || match.index > last.index) {
        last = { index: match.index, status: Number(match[1]) }
      }
    }
  }
  return last?.status ?? null
}

// Why every 4xx is permanent, 429 included: the owner's rule for ORCA-659 is that a
// client error fails on the first attempt.
export function isTransientFailure(text) {
  const status = lastHttpStatus(text)
  if (status !== null) {
    return status >= 500 && status <= 599
  }
  return DROPPED_CONNECTION.test(text)
}

/**
 * Runs `run` until it succeeds, fails permanently, or the backoff schedule is spent.
 * `run` returns a spawnSync-shaped result; a spawn error (e.g. ENOENT) is permanent.
 */
export function runWithTransientRetry({
  run,
  describe = 'command',
  backoffMs = TRANSIENT_RETRY_BACKOFF_MS,
  sleep = sleepSync,
  warn = console.warn
}) {
  for (let attempt = 1; ; attempt += 1) {
    const result = run()
    if (!result.error && result.status === 0) {
      return { ok: true, result, attempts: attempt }
    }
    const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
    const delay = backoffMs[attempt - 1]
    if (result.error || !isTransientFailure(output) || delay === undefined) {
      return { ok: false, result, attempts: attempt }
    }
    warn(
      `${describe} failed transiently (HTTP ${lastHttpStatus(output) ?? 'connection'}) on attempt ${attempt}; retrying in ${delay} ms`
    )
    sleep(delay)
  }
}
