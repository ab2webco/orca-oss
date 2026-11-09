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
import { _resetGhResolvedRemotesCache } from './pr-repository-order'

const {
  ghExecFileAsyncMock,
  gitExecFileAsyncMock,
  getOwnerRepoForRemoteMock,
  resolvePRRepositoryCandidatesMock
} = clientMocks

const ORIGIN = { owner: 'ab2webco', repo: 'orca-oss', host: 'github.com' }
const UPSTREAM = { owner: 'stablyai', repo: 'orca', host: 'github.com' }
const PR_NUMBER = 936

type FakePR = { title: string; headRefName: string; headOwner: string }

const prViewOf = (slug: string, pr: FakePR): string =>
  JSON.stringify({
    number: PR_NUMBER,
    title: pr.title,
    state: 'OPEN',
    url: `https://github.com/${slug}/pull/${PR_NUMBER}`,
    statusCheckRollup: [],
    updatedAt: '2026-11-09T00:00:00Z',
    isDraft: false,
    mergeable: 'MERGEABLE',
    baseRefName: 'main',
    headRefName: pr.headRefName,
    baseRefOid: 'base-oid',
    headRefOid: 'head-oid',
    headRepositoryOwner: { login: pr.headOwner }
  })

const restPROf = (slug: string, pr: FakePR): Record<string, unknown> => ({
  number: PR_NUMBER,
  title: pr.title,
  state: 'open',
  merged_at: null,
  html_url: `https://github.com/${slug}/pull/${PR_NUMBER}`,
  updated_at: '2026-11-09T00:00:00Z',
  draft: false,
  mergeable: true,
  base: { ref: 'main', sha: 'base-oid' },
  head: { ref: pr.headRefName, sha: 'head-oid', repo: { owner: { login: pr.headOwner } } }
})

// Why: the real candidate resolver runs here, so the order under test is production's, not a fixture's.
async function useRealCandidateOrder(ghResolved: string | null): Promise<void> {
  const actual = await vi.importActual<typeof GithubApiRepositoryModule>('./github-api-repository')
  getOwnerRepoForRemoteMock.mockImplementation(async (_repoPath: string, remoteName: string) =>
    remoteName === 'origin'
      ? { owner: ORIGIN.owner, repo: ORIGIN.repo }
      : remoteName === 'upstream'
        ? { owner: UPSTREAM.owner, repo: UPSTREAM.repo }
        : null
  )
  resolvePRRepositoryCandidatesMock.mockImplementation(actual.resolveGitHubApiRepositoryCandidates)
  gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
    if (args[0] === 'config' && args[1] === '--get-regexp') {
      if (ghResolved === null) {
        throw new Error('git config exited with code 1')
      }
      return { stdout: ghResolved }
    }
    return { stdout: '' }
  })
}

function serveRepos(prs: Record<string, FakePR>): string[][] {
  const calls: string[][] = []
  ghExecFileAsyncMock.mockImplementation(async (args: string[]) => {
    calls.push(args)
    if (args[0] === 'pr' && args[1] === 'view') {
      const slug = args[args.indexOf('--repo') + 1]
      const pr = prs[slug]
      if (!pr) {
        throw new Error('HTTP 404: Not Found')
      }
      return { stdout: prViewOf(slug, pr) }
    }
    const branchMatch =
      args[0] === 'api' ? /^repos\/([^/]+\/[^/]+)\/pulls\?head=([^&]+)&/.exec(args[1]) : null
    if (branchMatch) {
      const pr = prs[branchMatch[1]]
      const head = decodeURIComponent(branchMatch[2])
      return {
        stdout: JSON.stringify(
          pr && head === `${pr.headOwner}:${pr.headRefName}` ? [restPROf(branchMatch[1], pr)] : []
        )
      }
    }
    throw new Error('HTTP 404: Not Found')
  })
  return calls
}

const viewedRepos = (calls: string[][]): string[] =>
  calls
    .filter((args) => args[0] === 'pr' && args[1] === 'view')
    .map((args) => args[args.indexOf('--repo') + 1])

// #936 in stablyai/orca is an unrelated closed PR; ab2webco/orca-oss#936 is the worktree's.
const UPSTREAM_936: FakePR = {
  title: 'focus new term',
  headRefName: 'focus-new-term',
  headOwner: 'nwparker'
}
const ORIGIN_936: FakePR = {
  title: 'Native panel',
  headRefName: 'fabolivark/orca-1048-native-panel',
  headOwner: 'ab2webco'
}
const CONTRIBUTION: FakePR = {
  title: 'Contribution to upstream',
  headRefName: 'fix/terminal-focus',
  headOwner: 'ab2webco'
}

describe('getPRForBranchOutcome resolves a PR in the worktree repo before upstream (ORCA-1148)', () => {
  beforeEach(() => {
    resetPRForBranchMocks(clientMocks)
    _resetGhResolvedRemotesCache()
  })

  it('resolves #936 from a develop worktree to origin, not the unrelated upstream PR', async () => {
    await useRealCandidateOrder(null)
    serveRepos({ 'stablyai/orca': UPSTREAM_936, 'ab2webco/orca-oss': ORIGIN_936 })

    const outcome = await getPRForBranchOutcome('/repo-root', 'develop', PR_NUMBER)

    expect(outcome).toMatchObject({
      kind: 'found',
      pr: { number: PR_NUMBER, title: 'Native panel', prRepo: ORIGIN }
    })
  })

  it('resolves #936 on a detached HEAD from origin without probing upstream', async () => {
    await useRealCandidateOrder(null)
    const calls = serveRepos({ 'stablyai/orca': UPSTREAM_936, 'ab2webco/orca-oss': ORIGIN_936 })

    const outcome = await getPRForBranchOutcome('/repo-root', '', PR_NUMBER)

    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: ORIGIN } })
    expect(viewedRepos(calls)).toEqual(['ab2webco/orca-oss'])
  })

  it('still resolves a fork contribution whose PR number lives only upstream', async () => {
    await useRealCandidateOrder(null)
    serveRepos({ 'stablyai/orca': CONTRIBUTION })

    const outcome = await getPRForBranchOutcome('/repo-root', CONTRIBUTION.headRefName, PR_NUMBER)

    expect(outcome).toMatchObject({
      kind: 'found',
      pr: { title: 'Contribution to upstream', prRepo: UPSTREAM }
    })
  })

  it('prefers the upstream PR whose head is the branch over an unrelated fork PR', async () => {
    await useRealCandidateOrder(null)
    serveRepos({ 'stablyai/orca': CONTRIBUTION, 'ab2webco/orca-oss': ORIGIN_936 })

    const outcome = await getPRForBranchOutcome('/repo-root', CONTRIBUTION.headRefName, PR_NUMBER)

    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: UPSTREAM } })
  })

  it('finds a fork contribution by branch when the fork has no PR for it', async () => {
    await useRealCandidateOrder(null)
    serveRepos({ 'stablyai/orca': CONTRIBUTION })

    const outcome = await getPRForBranchOutcome('/repo-root', CONTRIBUTION.headRefName)

    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: UPSTREAM } })
  })

  it('finds the fork PR by branch before an upstream PR from the same head', async () => {
    await useRealCandidateOrder(null)
    const branchPR = { ...ORIGIN_936, headRefName: 'develop' }
    serveRepos({ 'stablyai/orca': branchPR, 'ab2webco/orca-oss': branchPR })

    const outcome = await getPRForBranchOutcome('/repo-root', 'develop')

    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: ORIGIN } })
  })

  it('honors `gh repo set-default` upstream on a detached HEAD', async () => {
    await useRealCandidateOrder('remote.upstream.gh-resolved base\n')
    const calls = serveRepos({ 'stablyai/orca': UPSTREAM_936, 'ab2webco/orca-oss': ORIGIN_936 })

    const outcome = await getPRForBranchOutcome('/repo-root', '', PR_NUMBER)

    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: UPSTREAM } })
    expect(viewedRepos(calls)).toEqual(['stablyai/orca'])
  })
})
