import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  gh: vi.fn(),
  origin: vi.fn(),
  upstream: vi.fn(),
  blocked: vi.fn(() => false),
  spend: vi.fn()
}))

vi.mock('./gh-utils', () => ({
  acquire: vi.fn(async () => undefined),
  release: vi.fn(),
  ghExecFileAsync: mocks.gh,
  ghRepoExecOptions: (context: { repoPath: string; connectionId: string | null }) =>
    context.connectionId ? {} : { cwd: context.repoPath },
  githubRepoContext: (repoPath: string, connectionId?: string | null) => ({
    repoPath,
    connectionId: connectionId ?? null
  })
}))
vi.mock('./github-api-repository', () => ({
  getOriginGitHubApiRepository: mocks.origin,
  getGitHubApiRepositoryForRemote: mocks.upstream,
  githubHostExecOptions: (repo: { host?: string } | null) => (repo?.host ? { host: repo.host } : {})
}))
vi.mock('./rate-limit', () => ({
  repositoryRateLimitGuard: () => ({ blocked: mocks.blocked() }),
  noteRepositoryRateLimitSpend: mocks.spend
}))

import { listMergedPullRequestsSince } from './merged-pull-requests'

const page = (items: unknown[], total: number) => ({
  stdout: JSON.stringify({ total_count: total, incomplete_results: false, items })
})
const merged = (number: number) => ({
  number,
  created_at: '2026-11-01T10:00:00Z',
  pull_request: { merged_at: '2026-11-01T12:00:00Z' }
})
const args = { repoPath: '/repo', since: '2026-10-18T14:08:27.123Z', now: 1 }

describe('listMergedPullRequestsSince', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.blocked.mockReturnValue(false)
    mocks.origin.mockResolvedValue({ owner: 'ab2webco', repo: 'orca-oss', host: 'github.com' })
    mocks.upstream.mockResolvedValue(null)
  })

  it('searches the repo for PRs merged since the window, to the second', async () => {
    mocks.gh.mockResolvedValueOnce(page([merged(1), merged(2)], 2))
    const delivery = await listMergedPullRequestsSince(args)
    expect(delivery?.reviews.map((one) => one.number)).toEqual([1, 2])
    expect(delivery?.repo).toBe('ab2webco/orca-oss')
    const [argv, options] = mocks.gh.mock.calls[0]
    expect(decodeURIComponent(argv[1])).toContain(
      'q=repo:ab2webco/orca-oss is:pr is:merged merged:>=2026-10-18T14:08:27Z&'
    )
    expect(options).toEqual({ cwd: '/repo', host: 'github.com' })
    expect(mocks.spend).toHaveBeenCalledTimes(1)
  })

  it("reads a fork's upstream unless the repo is pinned to origin", async () => {
    mocks.upstream.mockResolvedValue({ owner: 'up', repo: 'stream' })
    mocks.gh.mockResolvedValue(page([], 0))
    expect((await listMergedPullRequestsSince(args))?.repo).toBe('up/stream')
    expect((await listMergedPullRequestsSince({ ...args, preference: 'origin' }))?.repo).toBe(
      'ab2webco/orca-oss'
    )
  })

  it('answers null for a repo not on GitHub, without calling gh', async () => {
    mocks.origin.mockResolvedValue(null)
    await expect(listMergedPullRequestsSince(args)).resolves.toBeNull()
    expect(mocks.gh).not.toHaveBeenCalled()
  })

  it('spends nothing once the search budget is gone', async () => {
    mocks.blocked.mockReturnValue(true)
    await expect(listMergedPullRequestsSince(args)).rejects.toThrow(/budget/)
    expect(mocks.gh).not.toHaveBeenCalled()
  })
})
