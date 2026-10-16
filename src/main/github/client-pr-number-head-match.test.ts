import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GithubApiRepositoryModule from './github-api-repository'
import type * as GitHubEnterpriseRepositoryModule from './github-enterprise-repository'
import type { OwnerRepo } from './gh-utils'

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

const { ghExecFileAsyncMock, resolvePRRepositoryCandidatesMock } = clientMocks

const BRANCH = 'feat/orca-580-orchestrator-game'

type FakePR = {
  title: string
  state: 'OPEN' | 'MERGED'
  headRefName: string
  headOwner: string
}

// Why: gh/REST answer per repository, so the fake keys every response on the repo it targets.
function serveRepos(
  prs: Record<string, FakePR>,
  options: { ghCliDown?: boolean; rateLimitedRepo?: string } = {}
): string[][] {
  const calls: string[][] = []
  ghExecFileAsyncMock.mockImplementation(async (args: string[]) => {
    calls.push(args)
    if (options.rateLimitedRepo && args.join(' ').includes(options.rateLimitedRepo)) {
      throw new Error('HTTP 429: API rate limit exceeded')
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      if (options.ghCliDown) {
        throw new Error('HTTP 502: Bad Gateway')
      }
      const slug = args[args.indexOf('--repo') + 1]
      const pr = prs[slug]
      if (!pr) {
        throw new Error('HTTP 404: Not Found')
      }
      return {
        stdout: JSON.stringify({
          number: 465,
          title: pr.title,
          state: pr.state,
          url: `https://github.com/${slug}/pull/465`,
          statusCheckRollup: [],
          updatedAt: '2026-10-16T00:00:00Z',
          isDraft: false,
          mergeable: 'MERGEABLE',
          baseRefName: 'main',
          headRefName: pr.headRefName,
          baseRefOid: 'base-oid',
          headRefOid: 'head-oid',
          headRepositoryOwner: { login: pr.headOwner }
        })
      }
    }
    const restMatch = args[0] === 'api' ? /^repos\/([^/]+\/[^/]+)\/pulls\/465$/.exec(args[1]) : null
    const restPR = restMatch ? prs[restMatch[1]] : undefined
    if (restMatch && restPR) {
      return {
        stdout: JSON.stringify({
          number: 465,
          title: restPR.title,
          state: restPR.state === 'MERGED' ? 'closed' : 'open',
          merged_at: restPR.state === 'MERGED' ? '2026-10-01T00:00:00Z' : null,
          html_url: `https://github.com/${restMatch[1]}/pull/465`,
          updated_at: '2026-10-16T00:00:00Z',
          draft: false,
          mergeable: true,
          base: { ref: 'main', sha: 'base-oid' },
          head: {
            ref: restPR.headRefName,
            sha: 'head-oid',
            repo: { owner: { login: restPR.headOwner } }
          }
        })
      }
    }
    if (args[0] === 'api' && args[1].includes('/pulls?head=')) {
      return { stdout: '[]' }
    }
    throw new Error('HTTP 404: Not Found')
  })
  return calls
}

function useForkCandidates(host?: string): { upstream: OwnerRepo; origin: OwnerRepo } {
  const upstream = { owner: 'stablyai', repo: 'orca', ...(host ? { host } : {}) }
  const origin = { owner: 'ab2webco', repo: 'orca-oss', ...(host ? { host } : {}) }
  resolvePRRepositoryCandidatesMock.mockResolvedValue({
    candidates: [upstream, origin],
    headRepo: origin
  })
  return { upstream, origin }
}

const UPSTREAM_PR: FakePR = {
  title: 'organize repo root folder',
  state: 'MERGED',
  headRefName: 'organize-root',
  headOwner: 'stablyai'
}
const ORIGIN_PR: FakePR = {
  title: 'Orchestrator game',
  state: 'OPEN',
  headRefName: BRANCH,
  headOwner: 'ab2webco'
}

function viewedRepos(calls: string[][]): string[] {
  return calls
    .filter((args) => args[0] === 'pr' && args[1] === 'view')
    .map((args) => args[args.indexOf('--repo') + 1])
}

describe('getPRForBranchOutcome PR-number lookups in a fork that hosts its own PRs', () => {
  beforeEach(() => {
    resetPRForBranchMocks(clientMocks)
  })

  it('takes the linked PR from the candidate whose head is the worktree branch', async () => {
    const { origin } = useForkCandidates()
    serveRepos({ 'stablyai/orca': UPSTREAM_PR, 'ab2webco/orca-oss': ORIGIN_PR })

    const outcome = await getPRForBranchOutcome('/repo-root', BRANCH, 465)

    expect(outcome).toMatchObject({
      kind: 'found',
      pr: { number: 465, title: 'Orchestrator game', state: 'open', prRepo: origin }
    })
  })

  it('takes the fallback PR from the candidate whose head is the worktree branch', async () => {
    const { origin } = useForkCandidates()
    serveRepos({ 'stablyai/orca': UPSTREAM_PR, 'ab2webco/orca-oss': ORIGIN_PR })

    const outcome = await getPRForBranchOutcome('/repo-root', BRANCH, null, null, 465, {
      acceptMergedFallbackPR: true,
      currentHeadOid: 'head-oid'
    })

    expect(outcome).toMatchObject({
      kind: 'found',
      pr: { title: 'Orchestrator game', prRepo: origin }
    })
  })

  it('matches the head through the REST fallback when gh pr view fails', async () => {
    const { origin } = useForkCandidates()
    const calls = serveRepos(
      { 'stablyai/orca': UPSTREAM_PR, 'ab2webco/orca-oss': ORIGIN_PR },
      { ghCliDown: true }
    )

    const outcome = await getPRForBranchOutcome('/repo-root', BRANCH, 465)

    expect(calls).toContainEqual(['api', 'repos/ab2webco/orca-oss/pulls/465'])
    expect(outcome).toMatchObject({
      kind: 'found',
      pr: { title: 'Orchestrator game', prRepo: origin }
    })
  })

  it('keeps the host on every probe of a GitHub Enterprise fork', async () => {
    const host = 'ghe.example.com'
    const { origin } = useForkCandidates(host)
    serveRepos({ 'stablyai/orca': UPSTREAM_PR, 'ab2webco/orca-oss': ORIGIN_PR })

    const outcome = await getPRForBranchOutcome('/repo-root', BRANCH, 465)

    expect(ghExecFileAsyncMock).toHaveBeenCalledWith(
      expect.arrayContaining(['view', '465', '--repo', 'ab2webco/orca-oss']),
      expect.objectContaining({ host })
    )
    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: origin } })
  })

  it('rejects a same-named head pushed from another owner when origin owns one', async () => {
    const { origin } = useForkCandidates()
    serveRepos({
      'stablyai/orca': { ...UPSTREAM_PR, headRefName: BRANCH, headOwner: 'someone-else' },
      'ab2webco/orca-oss': { ...ORIGIN_PR, headOwner: 'AB2WEBCO' }
    })

    const outcome = await getPRForBranchOutcome('/repo-root', BRANCH, 465)

    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: origin } })
  })

  it('keeps the upstream PR of a fork contributor without probing origin', async () => {
    const { upstream } = useForkCandidates()
    const calls = serveRepos({
      'stablyai/orca': { ...ORIGIN_PR, title: 'Contributor PR' },
      'ab2webco/orca-oss': ORIGIN_PR
    })

    const outcome = await getPRForBranchOutcome('/repo-root', BRANCH, 465)

    expect(outcome).toMatchObject({
      kind: 'found',
      pr: { title: 'Contributor PR', prRepo: upstream }
    })
    expect(viewedRepos(calls)).toEqual(['stablyai/orca'])
  })

  it('keeps the upstream-first answer when no candidate head matches the branch', async () => {
    const { upstream } = useForkCandidates()
    serveRepos({
      'stablyai/orca': UPSTREAM_PR,
      'ab2webco/orca-oss': { ...ORIGIN_PR, headRefName: 'something-else' }
    })

    const outcome = await getPRForBranchOutcome('/repo-root', 'local-name', 465)

    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: upstream } })
  })

  it('keeps the upstream-first answer when probing the next candidate fails', async () => {
    const { upstream } = useForkCandidates()
    serveRepos(
      { 'stablyai/orca': UPSTREAM_PR, 'ab2webco/orca-oss': ORIGIN_PR },
      { rateLimitedRepo: 'ab2webco/orca-oss' }
    )

    const outcome = await getPRForBranchOutcome('/repo-root', BRANCH, 465)

    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: upstream } })
  })

  it('keeps the first exact match when the branch is unknown (detached HEAD)', async () => {
    const { upstream } = useForkCandidates()
    const calls = serveRepos({ 'stablyai/orca': UPSTREAM_PR, 'ab2webco/orca-oss': ORIGIN_PR })

    const outcome = await getPRForBranchOutcome('/repo-root', '', 465)

    expect(outcome).toMatchObject({ kind: 'found', pr: { prRepo: upstream } })
    expect(viewedRepos(calls)).toEqual(['stablyai/orca'])
  })
})
