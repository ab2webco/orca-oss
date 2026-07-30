import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetBitbucketRepoRefCache } from '../bitbucket/repository-ref'
import { getHostedReviewForBranch } from './hosted-review'
import { sendJson, useHostedReviewIntegrationFixtures } from './hosted-review-integration-fixture'

describe('Bitbucket hosted review integration', () => {
  const fixtures = useHostedReviewIntegrationFixtures()

  beforeEach(() => {
    _resetBitbucketRepoRefCache()
  })

  afterEach(() => {
    _resetBitbucketRepoRefCache()
  })

  it('resolves a Bitbucket PR through real git remote parsing and HTTP API calls', async () => {
    const { seen, repoPath } = await fixtures.start({
      env: (origin) => ({
        ORCA_BITBUCKET_ACCESS_TOKEN: 'local-token',
        ORCA_BITBUCKET_API_BASE_URL: `${origin}/2.0`,
        ORCA_BITBUCKET_EMAIL: null,
        ORCA_BITBUCKET_API_TOKEN: null
      }),
      remoteUrl: () => 'git@bitbucket.org:team/repo.git',
      route: (url, res) => {
        if (url.pathname === '/2.0/repositories/team/repo/pullrequests') {
          sendJson(res, {
            values: [
              {
                id: 12,
                title: 'Local Bitbucket branch',
                state: 'OPEN',
                updated_on: '2026-05-15T00:00:00Z',
                links: {
                  html: { href: 'https://bitbucket.org/team/repo/pull-requests/12' }
                },
                source: {
                  branch: { name: 'feature/bitbucket' },
                  commit: { hash: 'abc123' }
                }
              }
            ]
          })
          return true
        }

        if (url.pathname === '/2.0/repositories/team/repo/commit/abc123/statuses/build') {
          sendJson(res, { values: [{ state: 'SUCCESSFUL' }] })
          return true
        }

        return false
      }
    })

    await expect(
      getHostedReviewForBranch({ repoPath, branch: 'refs/heads/feature/bitbucket' })
    ).resolves.toEqual({
      provider: 'bitbucket',
      number: 12,
      title: 'Local Bitbucket branch',
      state: 'open',
      url: 'https://bitbucket.org/team/repo/pull-requests/12',
      status: 'success',
      updatedAt: '2026-05-15T00:00:00Z',
      mergeable: 'UNKNOWN',
      headSha: 'abc123'
    })

    expect(seen.map((request) => request.pathname)).toEqual([
      '/2.0/repositories/team/repo/pullrequests',
      '/2.0/repositories/team/repo/commit/abc123/statuses/build'
    ])
    expect(seen.every((request) => request.authorization === 'Bearer local-token')).toBe(true)
    const query = new URLSearchParams(seen[0].search)
    expect(query.get('q')).toContain('source.branch.name = "feature/bitbucket"')
    expect(query.getAll('state')).toEqual(['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'])
  })
})
