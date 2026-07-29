// Bounded retry for native rebuilds: a transient failure must not fail the job,
// a persistent one must still fail, and the backoff must grow per attempt.
import { describe, expect, it, vi } from 'vitest'

import {
  NATIVE_REBUILD_ATTEMPTS,
  RETRY_BACKOFF_MS,
  runWithRetries
} from './native-rebuild-retry.mjs'

const ok = { status: 0 }
const econnreset = { status: 1 }

function spawnSequence(results) {
  const calls = { count: 0 }
  return {
    calls,
    spawn: () => {
      calls.count += 1
      return results[Math.min(calls.count - 1, results.length - 1)]
    }
  }
}

describe('runWithRetries', () => {
  it('retries a transient failure and reports success', () => {
    const { calls, spawn } = spawnSequence([econnreset, ok])
    const outcome = runWithRetries({
      spawn,
      describe: 'pnpm rebuild node-pty',
      attempts: NATIVE_REBUILD_ATTEMPTS,
      sleep: vi.fn(),
      warn: vi.fn()
    })
    expect(outcome.ok).toBe(true)
    expect(calls.count).toBe(2)
  })

  it('gives up after the attempt budget and hands back the last result', () => {
    const { calls, spawn } = spawnSequence([econnreset])
    const outcome = runWithRetries({
      spawn,
      describe: 'pnpm rebuild node-pty',
      attempts: NATIVE_REBUILD_ATTEMPTS,
      sleep: vi.fn(),
      warn: vi.fn()
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.attempts).toBe(NATIVE_REBUILD_ATTEMPTS)
    expect(calls.count).toBe(NATIVE_REBUILD_ATTEMPTS)
    expect(outcome.result).toBe(econnreset)
  })

  it('backs off longer on each retry so a blipping endpoint gets room', () => {
    const sleep = vi.fn()
    const { spawn } = spawnSequence([econnreset])
    runWithRetries({
      spawn,
      describe: 'pnpm rebuild node-pty',
      attempts: 3,
      sleep,
      warn: vi.fn()
    })
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([RETRY_BACKOFF_MS, 2 * RETRY_BACKOFF_MS])
  })

  it('does not retry when the caller asked for a single attempt', () => {
    const { calls, spawn } = spawnSequence([econnreset])
    const sleep = vi.fn()
    const outcome = runWithRetries({ spawn, describe: 'pnpm install', sleep, warn: vi.fn() })
    expect(outcome.ok).toBe(false)
    expect(calls.count).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('treats a spawn error with a zero status as a failure worth retrying', () => {
    const { calls, spawn } = spawnSequence([{ status: 0, error: new Error('ENOENT') }, ok])
    const outcome = runWithRetries({
      spawn,
      describe: 'pnpm rebuild node-pty',
      attempts: 2,
      sleep: vi.fn(),
      warn: vi.fn()
    })
    expect(outcome.ok).toBe(true)
    expect(calls.count).toBe(2)
  })
})
