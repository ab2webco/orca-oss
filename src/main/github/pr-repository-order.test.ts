import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock, getSshGitProviderMock } = vi.hoisted(() => ({
  gitExecFileAsyncMock: vi.fn(),
  getSshGitProviderMock: vi.fn()
}))

vi.mock('../git/runner', () => ({ gitExecFileAsync: gitExecFileAsyncMock }))
vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock,
  getSshGitProviderGeneration: () => 0
}))

import {
  _resetGhResolvedRemotesCache,
  orderPullRequestRepositories,
  parseGhResolvedRemotes,
  resolvePullRequestRepositoryOrder
} from './pr-repository-order'

const ORIGIN = { owner: 'ab2webco', repo: 'orca-oss', host: 'github.com' }
const UPSTREAM = { owner: 'stablyai', repo: 'orca', host: 'github.com' }
const remotes = { origin: ORIGIN, upstream: UPSTREAM }

beforeEach(() => {
  gitExecFileAsyncMock.mockReset()
  getSshGitProviderMock.mockReset()
  _resetGhResolvedRemotesCache()
})

describe('parseGhResolvedRemotes', () => {
  it('reads every remote gh resolved, keeping remote-name case', () => {
    expect(
      parseGhResolvedRemotes(
        'remote.Upstream.gh-resolved base\r\nremote.origin.gh-resolved stablyai/orca\nnoise\n'
      )
    ).toEqual(
      new Map([
        ['Upstream', 'base'],
        ['origin', 'stablyai/orca']
      ])
    )
    expect(parseGhResolvedRemotes(undefined)).toEqual(new Map())
  })
})

describe('orderPullRequestRepositories', () => {
  it('starts in origin when gh names no default', () => {
    expect(orderPullRequestRepositories(remotes, new Map())).toEqual([ORIGIN, UPSTREAM])
  })

  it('starts in upstream when Orca is told to prefer upstream, whatever gh says', () => {
    expect(orderPullRequestRepositories(remotes, new Map([['origin', 'base']]), true)).toEqual([
      UPSTREAM,
      ORIGIN
    ])
  })

  it('keeps a lone remote and drops duplicates', () => {
    expect(orderPullRequestRepositories({ origin: null, upstream: UPSTREAM }, new Map())).toEqual([
      UPSTREAM
    ])
    expect(
      orderPullRequestRepositories({ origin: ORIGIN, upstream: { ...ORIGIN } }, new Map())
    ).toEqual([ORIGIN])
  })
})

describe('resolvePullRequestRepositoryOrder', () => {
  it('reads the gh default over SSH through the connection provider', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'remote.upstream.gh-resolved base\n' })
    getSshGitProviderMock.mockReturnValue({ exec })

    await expect(
      resolvePullRequestRepositoryOrder({ repoPath: '/srv/repo', connectionId: 'ssh-1' }, remotes)
    ).resolves.toEqual([UPSTREAM, ORIGIN])
    expect(exec).toHaveBeenCalledWith(
      ['config', '--get-regexp', '^remote\\..*\\.gh-resolved$'],
      '/srv/repo',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('falls back to origin first when the SSH runtime is disconnected', async () => {
    getSshGitProviderMock.mockReturnValue(undefined)

    await expect(
      resolvePullRequestRepositoryOrder({ repoPath: '/srv/repo', connectionId: 'ssh-1' }, remotes)
    ).resolves.toEqual([ORIGIN, UPSTREAM])
  })

  it('runs git in the WSL distro for a WSL repo', async () => {
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '' })

    await resolvePullRequestRepositoryOrder(
      { repoPath: '/home/u/repo', wslDistro: 'Ubuntu' },
      remotes
    )

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['config', '--get-regexp', '^remote\\..*\\.gh-resolved$'],
      expect.objectContaining({ cwd: '/home/u/repo', wslDistro: 'Ubuntu' })
    )
  })

  it('skips the git read when an explicit upstream preference decides the order', async () => {
    await expect(
      resolvePullRequestRepositoryOrder({ repoPath: '/repo' }, remotes, true)
    ).resolves.toEqual([UPSTREAM, ORIGIN])
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })
})
