import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetAzureDevOpsRepoRefCache } from '../azure-devops/repository-ref'
import { getHostedReviewForBranch } from './hosted-review'
import { sendJson, useHostedReviewIntegrationFixtures } from './hosted-review-integration-fixture'

const AZURE_REMOTE_URL = 'https://dev.azure.com/acme/Project/_git/repo'
const AZURE_REPO_PATH = '/acme/Project/_apis/git/repositories/repo'
const AZURE_PULL_REQUESTS_PATH = '/acme/Project/_apis/git/repositories/repo-guid/pullRequests'

function azureEnv(origin: string): Readonly<Record<string, string>> {
  return {
    ORCA_AZURE_DEVOPS_TOKEN: 'local-pat',
    ORCA_AZURE_DEVOPS_API_BASE_URL: `${origin}/acme/Project`
  }
}

describe('Azure DevOps hosted review integration', () => {
  const fixtures = useHostedReviewIntegrationFixtures()

  beforeEach(() => {
    _resetAzureDevOpsRepoRefCache()
  })

  afterEach(() => {
    _resetAzureDevOpsRepoRefCache()
  })

  it('resolves an Azure Repos PR through real git remote parsing and HTTP API calls', async () => {
    const { seen, repoPath } = await fixtures.start({
      env: azureEnv,
      remoteUrl: () => AZURE_REMOTE_URL,
      route: (url, res) => {
        if (url.pathname === AZURE_REPO_PATH) {
          sendJson(res, { id: 'repo-guid', webUrl: AZURE_REMOTE_URL })
          return true
        }

        if (url.pathname === AZURE_PULL_REQUESTS_PATH) {
          expect(url.searchParams.get('searchCriteria.sourceRefName')).toBe(
            'refs/heads/feature/azure'
          )
          sendJson(res, {
            value: [
              {
                pullRequestId: 31,
                title: 'Azure branch',
                status: 'active',
                creationDate: '2026-05-16T00:00:00Z',
                mergeStatus: 'succeeded',
                lastMergeSourceCommit: { commitId: 'abc123' }
              }
            ]
          })
          return true
        }

        if (url.pathname === `${AZURE_PULL_REQUESTS_PATH}/31/statuses`) {
          sendJson(res, { value: [{ state: 'succeeded' }] })
          return true
        }

        return false
      }
    })

    await expect(
      getHostedReviewForBranch({ repoPath, branch: 'refs/heads/feature/azure' })
    ).resolves.toEqual({
      provider: 'azure-devops',
      number: 31,
      title: 'Azure branch',
      state: 'open',
      url: `${AZURE_REMOTE_URL}/pullrequest/31`,
      status: 'success',
      updatedAt: '2026-05-16T00:00:00Z',
      mergeable: 'MERGEABLE',
      headSha: 'abc123'
    })

    expect(seen.map((request) => request.pathname)).toEqual([
      AZURE_REPO_PATH,
      AZURE_PULL_REQUESTS_PATH,
      `${AZURE_PULL_REQUESTS_PATH}/31/statuses`
    ])
    expect(seen.every((request) => request.authorization === 'Basic OmxvY2FsLXBhdA==')).toBe(true)
  })

  it('prefers an active Azure Repos PR over a newer abandoned PR for the same branch', async () => {
    const { seen, repoPath } = await fixtures.start({
      env: azureEnv,
      remoteUrl: () => AZURE_REMOTE_URL,
      route: (url, res) => {
        if (url.pathname === AZURE_REPO_PATH) {
          sendJson(res, { id: 'repo-guid', webUrl: AZURE_REMOTE_URL })
          return true
        }

        if (url.pathname === AZURE_PULL_REQUESTS_PATH) {
          sendJson(res, {
            value: [
              {
                pullRequestId: 40,
                title: 'Abandoned branch',
                status: 'abandoned',
                creationDate: '2026-05-10T00:00:00Z',
                closedDate: '2026-05-20T00:00:00Z',
                mergeStatus: 'conflicts',
                lastMergeSourceCommit: { commitId: 'old123' }
              },
              {
                pullRequestId: 41,
                title: 'Active branch',
                status: 'active',
                creationDate: '2026-05-01T00:00:00Z',
                mergeStatus: 'succeeded',
                lastMergeSourceCommit: { commitId: 'active123' }
              }
            ]
          })
          return true
        }

        if (url.pathname === `${AZURE_PULL_REQUESTS_PATH}/40/statuses`) {
          sendJson(res, { value: [{ state: 'failed' }] })
          return true
        }

        if (url.pathname === `${AZURE_PULL_REQUESTS_PATH}/41/statuses`) {
          sendJson(res, { value: [{ state: 'succeeded' }] })
          return true
        }

        return false
      }
    })

    await expect(
      getHostedReviewForBranch({ repoPath, branch: 'refs/heads/feature/azure' })
    ).resolves.toMatchObject({
      provider: 'azure-devops',
      number: 41,
      title: 'Active branch',
      state: 'open',
      status: 'success',
      mergeable: 'MERGEABLE',
      headSha: 'active123'
    })

    expect(seen.map((request) => request.pathname)).toContain(
      `${AZURE_PULL_REQUESTS_PATH}/41/statuses`
    )
  })
})
