import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock, getSshGitProviderGenerationMock, getSshGitProviderMock } = vi.hoisted(
  () => ({
    gitExecFileAsyncMock: vi.fn(),
    getSshGitProviderGenerationMock: vi.fn(() => 0),
    getSshGitProviderMock: vi.fn()
  })
)

vi.mock('../git/runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock,
  ghExecFileAsync: vi.fn()
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProviderGeneration: getSshGitProviderGenerationMock,
  getSshGitProvider: getSshGitProviderMock
}))

import { _resetOwnerRepoCache, resolvePRRepositoryCandidates } from './gh-utils'
import { __resetLocalGitConfigSignatureCacheForTests } from './local-git-config-signature'
import { _resetGhResolvedRemotesCache } from './pr-repository-order'

// ORCA-1148: a fork hosting its own PRs (ab2webco/orca-oss) shares PR numbers with its upstream.
describe('resolvePRRepositoryCandidates order', () => {
  const ORIGIN = { owner: 'ab2webco', repo: 'orca-oss' }
  const UPSTREAM = { owner: 'stablyai', repo: 'orca' }

  function serveRemotes(ghResolved: string | null): string[][] {
    const calls: string[][] = []
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      calls.push(args)
      if (args[0] === 'remote' && args[1] === 'get-url') {
        const urls: Record<string, string> = {
          origin: 'git@github.com:ab2webco/orca-oss.git\n',
          upstream: 'https://github.com/stablyai/orca.git\n'
        }
        return { stdout: urls[args[2]] ?? '' }
      }
      if (args[0] === 'config' && args[1] === '--get-regexp') {
        if (ghResolved === null) {
          throw Object.assign(new Error('git config exited 1'), { code: 1 })
        }
        return { stdout: ghResolved }
      }
      throw new Error(`unexpected git ${args.join(' ')}`)
    })
    return calls
  }

  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
    getSshGitProviderGenerationMock.mockReset()
    getSshGitProviderGenerationMock.mockReturnValue(0)
    getSshGitProviderMock.mockReset()
    _resetOwnerRepoCache()
    _resetGhResolvedRemotesCache()
    __resetLocalGitConfigSignatureCacheForTests()
  })

  it("looks in the worktree's own repo before upstream when gh has no default", async () => {
    serveRemotes(null)

    await expect(resolvePRRepositoryCandidates('/repo')).resolves.toEqual({
      candidates: [ORIGIN, UPSTREAM],
      headRepo: ORIGIN
    })
  })

  it('puts upstream first when `gh repo set-default` chose it', async () => {
    serveRemotes('remote.upstream.gh-resolved base\n')

    await expect(resolvePRRepositoryCandidates('/repo')).resolves.toEqual({
      candidates: [UPSTREAM, ORIGIN],
      headRepo: ORIGIN
    })
  })

  it('reads an owner/repo gh default recorded on the origin remote', async () => {
    serveRemotes('remote.origin.gh-resolved StablyAI/Orca\n')

    await expect(resolvePRRepositoryCandidates('/repo')).resolves.toEqual({
      candidates: [UPSTREAM, ORIGIN],
      headRepo: ORIGIN
    })
  })

  it('never adds a gh default that is not one of the remotes', async () => {
    serveRemotes('remote.origin.gh-resolved someone/else\n')

    await expect(resolvePRRepositoryCandidates('/repo')).resolves.toEqual({
      candidates: [ORIGIN, UPSTREAM],
      headRepo: ORIGIN
    })
  })

  it('reads the gh default once per TTL and not at all for a single remote', async () => {
    const calls = serveRemotes('remote.upstream.gh-resolved base\n')
    await resolvePRRepositoryCandidates('/repo')
    await resolvePRRepositoryCandidates('/repo')
    expect(calls.filter((args) => args[0] === 'config')).toHaveLength(1)

    gitExecFileAsyncMock.mockReset()
    const single: string[][] = []
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      single.push(args)
      if (args[2] === 'origin') {
        return { stdout: 'git@github.com:ab2webco/orca-oss.git\n' }
      }
      throw new Error("error: No such remote 'upstream'")
    })
    await expect(resolvePRRepositoryCandidates('/single')).resolves.toEqual({
      candidates: [ORIGIN],
      headRepo: ORIGIN
    })
    expect(single.filter((args) => args[0] === 'config')).toHaveLength(0)
  })
})
