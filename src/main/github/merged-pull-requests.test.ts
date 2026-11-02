import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Runner from '../git/runner'

const mocks = vi.hoisted(() => ({ gh: vi.fn(), blocked: vi.fn(() => false), spend: vi.fn() }))

// Why only gh: the repo is resolved from a real checkout's remotes, as the Panel's My PRs does.
vi.mock('../git/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof Runner>()),
  ghExecFileAsync: mocks.gh
}))
vi.mock('./rate-limit', () => ({
  repositoryRateLimitGuard: () => ({ blocked: mocks.blocked() }),
  noteRepositoryRateLimitSpend: mocks.spend
}))

import { listMergedPullRequestsSince } from './merged-pull-requests'

const roots: string[] = []
function checkout(remotes: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-merged-prs-'))
  roots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  for (const [name, url] of Object.entries(remotes)) {
    execFileSync('git', ['remote', 'add', name, url], { cwd: root })
  }
  return root
}

const page = (items: unknown[], total: number) => ({
  stdout: JSON.stringify({ total_count: total, incomplete_results: false, items })
})
const merged = (number: number) => ({
  number,
  created_at: '2026-11-01T10:00:00Z',
  pull_request: { merged_at: '2026-11-01T12:00:00Z' }
})
const since = '2026-10-18T14:08:27.123Z'
const queryOf = (call: unknown[]): string => decodeURIComponent((call[0] as string[])[1])

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('listMergedPullRequestsSince', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.blocked.mockReturnValue(false)
  })

  it("counts origin's merges in a fork whose upstream is another repo", async () => {
    const repoPath = checkout({
      origin: 'https://github.com/ab2webco/orca-oss.git',
      upstream: 'https://github.com/stablyai/orca.git'
    })
    mocks.gh.mockResolvedValueOnce(page([merged(1), merged(2)], 2))

    const delivery = await listMergedPullRequestsSince({ repoPath, since, now: 1 })

    expect(delivery?.repo).toBe('ab2webco/orca-oss')
    expect(delivery?.reviews.map((one) => one.number)).toEqual([1, 2])
    expect(mocks.gh).toHaveBeenCalledTimes(1)
    const query = queryOf(mocks.gh.mock.calls[0])
    expect(query).toContain(
      'q=repo:ab2webco/orca-oss is:pr is:merged merged:>=2026-10-18T14:08:27Z&'
    )
    expect(query).not.toContain('stablyai')
    expect(mocks.gh.mock.calls[0][1]).toMatchObject({ cwd: repoPath, host: 'github.com' })
    expect(mocks.spend).toHaveBeenCalledTimes(1)
  })

  it('answers null for a repo whose origin is not on GitHub, without searching', async () => {
    const repoPath = checkout({
      origin: 'https://gitlab.com/group/project.git',
      upstream: 'https://github.com/stablyai/orca.git'
    })
    mocks.gh.mockRejectedValue(new Error('not a GitHub host'))
    await expect(listMergedPullRequestsSince({ repoPath, since, now: 1 })).resolves.toBeNull()
    // Why not "no gh at all": the resolver itself asks gh whether gitlab.com is an Enterprise host.
    const searches = mocks.gh.mock.calls.filter((call) =>
      (call[0] as string[]).some((one) => one.startsWith('search/'))
    )
    expect(searches).toEqual([])
  })

  it('spends nothing once the search budget is gone', async () => {
    const repoPath = checkout({ origin: 'https://github.com/ab2webco/orca-oss.git' })
    mocks.blocked.mockReturnValue(true)
    await expect(listMergedPullRequestsSince({ repoPath, since, now: 1 })).rejects.toThrow(/budget/)
    expect(mocks.gh).not.toHaveBeenCalled()
  })
})
