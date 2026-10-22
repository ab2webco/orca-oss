// A transient 5xx from GitHub or Docker Hub must be retried a bounded number of
// times; a 4xx or a missing binary must fail on the first attempt (ORCA-659).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  TRANSIENT_RETRY_BACKOFF_MS,
  isTransientFailure,
  lastHttpStatus,
  runWithTransientRetry
} from './transient-http-retry.mjs'

// Verbatim from PR #521 run 39273171134 and PR #599 job 119899581280.
const GH_502 = 'gh: Server Error (HTTP 502)\n'
const GH_404 = 'gh: Not Found (HTTP 404)\n'
const DOCKER_500 =
  '#3 ERROR: failed to copy: httpReadSeeker: failed open: unexpected status code ' +
  'https://registry-1.docker.io/v2/library/ubuntu/manifests/sha256:678c6550cc43645e08669028bc177f50be4e7c5b8cca677067b1914d4afc7a03: 500 Internal Server Error\n'

const failed = (stderr) => ({ status: 1, stdout: '', stderr })
const ok = { status: 0, stdout: '{}', stderr: '' }

function sequence(results) {
  const calls = { count: 0 }
  return {
    calls,
    run: () => {
      calls.count += 1
      return results[Math.min(calls.count - 1, results.length - 1)]
    }
  }
}

describe('lastHttpStatus', () => {
  it('reads the status gh prints', () => {
    expect(lastHttpStatus(GH_502)).toBe(502)
    expect(lastHttpStatus(GH_404)).toBe(404)
  })

  it('reads the status a registry returns to docker build', () => {
    expect(lastHttpStatus(DOCKER_500)).toBe(500)
  })

  it('returns null when no status was printed', () => {
    expect(lastHttpStatus('error connecting to api.github.com\n')).toBeNull()
  })
})

describe('isTransientFailure', () => {
  it('treats 5xx and dropped connections as transient', () => {
    expect(isTransientFailure(GH_502)).toBe(true)
    expect(isTransientFailure(DOCKER_500)).toBe(true)
    expect(isTransientFailure('read tcp 10.1.0.4:443: read: connection reset by peer\n')).toBe(true)
  })

  // Why 429 too: the owner's rule is that every 4xx fails fast.
  it('treats 4xx and unrecognised errors as permanent', () => {
    expect(isTransientFailure(GH_404)).toBe(false)
    expect(isTransientFailure('gh: API rate limit exceeded (HTTP 429)\n')).toBe(false)
    expect(
      isTransientFailure('gh: To use GitHub CLI in a GitHub Actions workflow, set GH_TOKEN\n')
    ).toBe(false)
  })
})

describe('runWithTransientRetry', () => {
  it('retries a 502 and reports success', () => {
    const { calls, run } = sequence([failed(GH_502), ok])
    const outcome = runWithTransientRetry({ run, sleep: vi.fn(), warn: vi.fn() })
    expect(outcome.ok).toBe(true)
    expect(calls.count).toBe(2)
  })

  it('fails a 404 after exactly one call with no sleep', () => {
    const sleep = vi.fn()
    const { calls, run } = sequence([failed(GH_404)])
    const outcome = runWithTransientRetry({ run, sleep, warn: vi.fn() })
    expect(outcome.ok).toBe(false)
    expect(calls.count).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('fails fast when the binary could not be spawned', () => {
    const { calls, run } = sequence([{ status: null, error: new Error('spawnSync gh ENOENT') }])
    expect(runWithTransientRetry({ run, sleep: vi.fn(), warn: vi.fn() }).ok).toBe(false)
    expect(calls.count).toBe(1)
  })

  it('gives up on a sustained outage after the bounded attempts, backing off longer each time', () => {
    const sleep = vi.fn()
    const { calls, run } = sequence([failed(GH_502)])
    const outcome = runWithTransientRetry({ run, sleep, warn: vi.fn() })
    expect(outcome.ok).toBe(false)
    expect(calls.count).toBe(TRANSIENT_RETRY_BACKOFF_MS.length + 1)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(TRANSIENT_RETRY_BACKOFF_MS)
    // Why bounded: the reporter job's cap is 10 minutes.
    expect(TRANSIENT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(120_000)
  })
})

describe('headless serve shutdown docker rig', () => {
  // Why: Docker Hub answered 500 on the base image manifest and failed PR #599's
  // package job at `docker build` (ORCA-659 comment).
  it('builds its image through the transient retry', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, 'run-headless-serve-shutdown-docker.mjs'),
      'utf8'
    )
    expect(source).toMatch(
      /docker\(\s*\[\s*'build'[^\]]*\],(?:\s*\/\/[^\n]*)*\s*\{\s*retryTransient: true\s*\}\s*\)/
    )
  })
})
