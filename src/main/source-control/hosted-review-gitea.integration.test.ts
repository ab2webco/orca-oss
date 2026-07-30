import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetGiteaRepoRefCache } from '../gitea/repository-ref'
import { getHostedReviewForBranch } from './hosted-review'
import { sendJson, useHostedReviewIntegrationFixtures } from './hosted-review-integration-fixture'

describe('Gitea hosted review integration', () => {
  const fixtures = useHostedReviewIntegrationFixtures()

  beforeEach(() => {
    _resetGiteaRepoRefCache()
  })

  afterEach(() => {
    _resetGiteaRepoRefCache()
  })

  it('resolves a Gitea PR through real git remote parsing and HTTP API calls', async () => {
    const { seen, repoPath, origin } = await fixtures.start({
      env: () => ({ ORCA_GITEA_TOKEN: 'local-token', ORCA_GITEA_API_BASE_URL: null }),
      remoteUrl: (base) => `${base}/team/repo.git`,
      route: (url, res) => {
        if (url.pathname === '/api/v1/repos/team/repo/pulls') {
          sendJson(res, [
            {
              number: 9,
              title: 'Local Gitea branch',
              state: 'open',
              html_url: 'http://127.0.0.1/team/repo/pulls/9',
              updated_at: '2026-05-15T00:00:00Z',
              mergeable: true,
              head: { ref: 'feature/gitea', label: 'team:feature/gitea', sha: 'abc123' }
            }
          ])
          return true
        }

        if (url.pathname === '/api/v1/repos/team/repo/commits/abc123/status') {
          sendJson(res, { state: 'success' })
          return true
        }

        return false
      }
    })

    await expect(
      getHostedReviewForBranch({ repoPath, branch: 'refs/heads/feature/gitea' })
    ).resolves.toEqual({
      provider: 'gitea',
      number: 9,
      title: 'Local Gitea branch',
      state: 'open',
      url: 'http://127.0.0.1/team/repo/pulls/9',
      status: 'success',
      updatedAt: '2026-05-15T00:00:00Z',
      mergeable: 'MERGEABLE',
      headSha: 'abc123'
    })

    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(seen.map((request) => request.pathname)).toEqual([
      '/api/v1/repos/team/repo/pulls',
      '/api/v1/repos/team/repo/commits/abc123/status'
    ])
    expect(seen.every((request) => request.authorization === 'token local-token')).toBe(true)
    expect(new URLSearchParams(seen[0].search).get('state')).toBe('all')
  })
})
