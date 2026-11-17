import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GithubApiRepositoryModule from './github-api-repository'
import type * as GitHubEnterpriseRepositoryModule from './github-enterprise-repository'

const { clientMocks, moduleMocks } = await vi.hoisted(async () => {
  const moduleMocks = await import('./client-test-mocks')
  return { clientMocks: moduleMocks.createGitHubClientMocks(), moduleMocks }
})

vi.mock('./gh-utils', () => moduleMocks.ghUtilsModuleMock(clientMocks))
vi.mock('../git/runner', () => moduleMocks.gitRunnerModuleMock(clientMocks))
vi.mock('../providers/ssh-git-dispatch', () => moduleMocks.sshGitDispatchModuleMock(clientMocks))
vi.mock('./local-git-config-signature', () =>
  moduleMocks.localGitConfigSignatureModuleMock(clientMocks)
)
vi.mock('./github-enterprise-repository', async (importOriginal) =>
  moduleMocks.githubEnterpriseRepositoryModuleMock(
    await importOriginal<typeof GitHubEnterpriseRepositoryModule>()
  )
)
vi.mock('./rate-limit', () => moduleMocks.rateLimitModuleMock(clientMocks))
vi.mock('./github-api-repository', async (importOriginal) =>
  moduleMocks.githubApiRepositoryModuleMock(
    clientMocks,
    await importOriginal<typeof GithubApiRepositoryModule>()
  )
)

import { getPRForBranchOutcome } from './client'
import { resetPRForBranchMocks } from './client-test-harness'

const { ghExecFileAsyncMock, getOwnerRepoMock } = clientMocks

const BRANCH_ROW = {
  number: 42,
  title: 'Dedupe PR reads',
  state: 'open',
  html_url: 'https://github.com/acme/widgets/pull/42',
  updated_at: '2026-11-16T00:00:00Z',
  draft: false,
  head: { ref: 'feature/dedupe', sha: 'head-oid' },
  base: { ref: 'main', sha: 'base-oid' }
}
const PR_VIEW = {
  number: 42,
  title: 'Dedupe PR reads',
  state: 'OPEN',
  url: 'https://github.com/acme/widgets/pull/42',
  statusCheckRollup: [],
  updatedAt: '2026-11-16T00:00:00Z',
  isDraft: false,
  mergeable: 'MERGEABLE',
  baseRefName: 'main',
  headRefName: 'feature/dedupe',
  baseRefOid: 'base-oid',
  headRefOid: 'head-oid'
}

const included = (body: unknown): string =>
  `HTTP/2.0 200 OK\r\nEtag: W/"rows"\r\n\r\n${JSON.stringify(body)}`

let branchListResponses: string[]
function mockGitHub(): void {
  ghExecFileAsyncMock.mockImplementation(async (args: string[]) => {
    if (args[0] === 'api' && args[1].includes('/pulls?head=')) {
      if (args.includes('If-None-Match: W/"rows"')) {
        branchListResponses.push('304')
        throw Object.assign(new Error('gh: HTTP 304'), {
          stderr: 'gh: HTTP 304',
          stdout: 'HTTP/2.0 304 Not Modified\r\nEtag: "rows"\r\n\r\n'
        })
      }
      branchListResponses.push('200')
      return { stdout: included([BRANCH_ROW]), stderr: '' }
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return { stdout: JSON.stringify(PR_VIEW), stderr: '' }
    }
    if (args[0] === 'api' && args[1].startsWith('repos/acme/widgets/branches/')) {
      return { stdout: JSON.stringify({ protected: false }), stderr: '' }
    }
    return { stdout: '{}', stderr: '' }
  })
}

// The sidebar's refresh coordinator, the panel's hostedReview poll and the lead's game.state.
const consumers = [
  () =>
    getPRForBranchOutcome('/repo-root', 'feature/dedupe', null, null, null, {
      currentHeadOid: 'head-oid'
    }),
  () => getPRForBranchOutcome('/repo-root', 'feature/dedupe', null, null, null),
  () => getPRForBranchOutcome('/repo-root', 'refs/heads/feature/dedupe')
]
const prViews = (): number =>
  ghExecFileAsyncMock.mock.calls.filter(([args]) => args[0] === 'pr' && args[1] === 'view').length

describe('PR reads shared across consumers (ORCA-1213)', () => {
  beforeEach(() => {
    resetPRForBranchMocks(clientMocks)
    getOwnerRepoMock.mockResolvedValue({ owner: 'acme', repo: 'widgets' })
    branchListResponses = []
    mockGitHub()
  })

  it('makes one branch-list request and one pr view for N concurrent consumers', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 3 }, () => consumers.map((read) => read())).flat()
    )

    expect(outcomes.every((one) => one.kind === 'found' && one.pr.number === 42)).toBe(true)
    expect(branchListResponses).toEqual(['200'])
    expect(prViews()).toBe(1)
  })

  it('bills nothing for the next poll of an unchanged PR', async () => {
    await Promise.all(consumers.map((read) => read()))
    for (const read of consumers) {
      expect(await read()).toMatchObject({ kind: 'found', pr: { number: 42 } })
    }

    expect(branchListResponses).toEqual(['200', '304', '304', '304'])
    expect(prViews()).toBe(1)
  })
})

describe('a refresh a person asked for (ORCA-1213)', () => {
  beforeEach(() => {
    resetPRForBranchMocks(clientMocks)
    getOwnerRepoMock.mockResolvedValue({ owner: 'acme', repo: 'widgets' })
    branchListResponses = []
    mockGitHub()
  })

  it('reads the PR again instead of taking the shared pr view', async () => {
    await consumers[0]()
    await getPRForBranchOutcome('/repo-root', 'feature/dedupe', null, null, null, {
      refreshPRView: true
    })

    expect(prViews()).toBe(2)
  })
})
