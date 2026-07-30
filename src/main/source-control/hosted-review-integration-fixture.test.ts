import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HOSTED_REVIEW_GH_PROBE_TIMEOUT_MS,
  sendJson,
  useHostedReviewIntegrationFixtures
} from './hosted-review-integration-fixture'

async function isRefused(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) })
    return false
  } catch {
    return true
  }
}

describe('hosted review integration fixture', () => {
  const fixtures = useHostedReviewIntegrationFixtures()
  let abandoned: { origin: string; repoPath: string } | null = null

  // Why: ORCA-119 — a case that outruns testTimeout has its promise abandoned,
  // so cleanup written in the case body never runs and the still-listening
  // server keeps the pool worker alive for the rest of the shard.
  it('releases an abandoned fixture from the suite hook, not the case body', async () => {
    const fixture = await fixtures.start({
      remoteUrl: (origin) => `${origin}/team/repo.git`,
      route: (url, res) => {
        if (url.pathname === '/ping') {
          sendJson(res, { ok: true })
          return true
        }
        return false
      }
    })
    abandoned = { origin: fixture.origin, repoPath: fixture.repoPath }

    await expect(isRefused(`${fixture.origin}/ping`)).resolves.toBe(false)
    expect(existsSync(fixture.repoPath)).toBe(true)
    expect(process.env.ORCA_GH_EXEC_TIMEOUT_MS).toBe(String(HOSTED_REVIEW_GH_PROBE_TIMEOUT_MS))
  })

  it('leaves no listening server, temp directory, or env override behind', async () => {
    expect(abandoned).not.toBeNull()
    const released = abandoned as { origin: string; repoPath: string }

    await expect(isRefused(`${released.origin}/ping`)).resolves.toBe(true)
    expect(existsSync(released.repoPath)).toBe(false)
    expect(process.env.ORCA_GH_EXEC_TIMEOUT_MS).toBeUndefined()
  })

  // Why: the runner's own gh default is 30s — the same value as testTimeout in
  // config/vitest.config.ts — so an unbounded probe can only ever be killed by
  // the test budget expiring first. Ratchet the fixture bound far below it.
  it('keeps the gh probe bound far below the 30s test timeout', () => {
    expect(HOSTED_REVIEW_GH_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(5_000)
  })
})
