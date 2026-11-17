import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectGitOwnRemoteKey } from '../../../repo-git-remote-identity'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_MEMBER_REPO_SCOPE_METHODS } from './orchestrator-game-member-repo-scope'

vi.mock('../../../repo-git-remote-identity', () => ({
  detectGitOwnRemoteKey: vi.fn()
}))

beforeEach(() => {
  vi.mocked(detectGitOwnRemoteKey).mockReset()
})

const record = (
  id: string,
  name: string,
  canonicalKey: string | null,
  remoteName = 'origin',
  connectionId: string | null = null
) => ({
  id,
  displayName: name,
  path: `/work/${name}`,
  kind: 'git',
  connectionId,
  gitRemoteIdentity: canonicalKey
    ? { canonicalKey, remoteName, remoteUrl: `git@${canonicalKey}.git` }
    : null
})

const netsat = record('r_netsat', 'helpdesk_netsat', 'github.com/ab2webco/helpdesk_netsat')
const orca = record('h_orca', 'orca-oss', 'github.com/ab2webco/orca-oss')

const summary = (repo: ReturnType<typeof record>) => ({
  id: repo.id,
  displayName: repo.displayName,
  path: repo.path,
  remoteKey: repo.gitRemoteIdentity?.canonicalKey ?? null,
  ownRemoteKey: repo.gitRemoteIdentity?.canonicalKey ?? null
})

function dispatcherWith(runtime: Record<string, unknown>) {
  const dispatcher = new RpcDispatcher({
    runtime: {
      getRuntimeId: () => 'runtime',
      ...runtime
    } as unknown as OrcaRuntimeService,
    methods: ORCHESTRATOR_GAME_MEMBER_REPO_SCOPE_METHODS
  })
  return async (params: unknown) =>
    await dispatcher.dispatch({
      id: 'm',
      authToken: 'test',
      method: 'game.memberRepoScope',
      params
    })
}

const localOrca = record('r_orca', 'orca-oss', 'github.com/ab2webco/orca-oss')
const localRepos: Record<string, ReturnType<typeof record>> = {
  'id:r_netsat': netsat,
  'name:orca-oss': localOrca
}

describe('game.memberRepoScope (ORCA-1156)', () => {
  it("reads the lead's repo and the selected one on this host", async () => {
    const send = dispatcherWith({
      showRepo: async (selector: string) =>
        localRepos[selector] ?? Promise.reject(new Error('repo_not_found'))
    })

    await expect(send({ leadRepo: 'r_netsat', repo: 'name:orca-oss' })).resolves.toMatchObject({
      ok: true,
      result: {
        host: null,
        lead: summary(netsat),
        repo: summary(localOrca),
        repos: []
      }
    })
    await expect(send({ leadRepo: 'r_netsat', repo: 'name:nope' })).resolves.toMatchObject({
      result: { repo: null }
    })
  })

  it("reads the paired host's repos with its old repo.list and repo.show", async () => {
    const calls: [string, string, unknown][] = []
    const send = dispatcherWith({
      showRepo: async () => netsat,
      resolveOrchestrationWorkerServer: () => ({
        environmentId: 'env_m1',
        name: 'm1'
      }),
      callOrchestrationWorkerServer: async (env: string, method: string, params: unknown) => {
        calls.push([env, method, params])
        if (method === 'repo.list') {
          return { repos: [orca] }
        }
        return { repo: orca }
      }
    })

    await expect(
      send({ leadRepo: 'r_netsat', repo: 'name:orca-oss', on: 'm1' })
    ).resolves.toMatchObject({
      ok: true,
      result: {
        host: 'm1',
        lead: summary(netsat),
        repo: summary(orca),
        repos: [summary(orca)]
      }
    })
    expect(calls.map(([env, method]) => `${env} ${method}`)).toEqual([
      'env_m1 repo.list',
      'env_m1 repo.show'
    ])
  })

  // Why: a folder workspace has no remote by design, so it must not read as an unidentified clone (ORCA-1250).
  it("keeps a host repo's kind, so a folder workspace is never taken for a clone", async () => {
    const notes = { ...record('h_notes', 'notes', null), kind: 'folder' }
    const send = dispatcherWith({
      showRepo: async () => netsat,
      resolveOrchestrationWorkerServer: () => ({ environmentId: 'env_m1', name: 'm1' }),
      callOrchestrationWorkerServer: async (_env: string, method: string) =>
        method === 'repo.list' ? { repos: [notes, orca] } : { repo: orca }
    })

    await expect(
      send({ leadRepo: 'r_netsat', repo: 'name:orca-oss', on: 'm1' })
    ).resolves.toMatchObject({
      result: {
        repos: [
          { id: 'h_notes', kind: 'folder' },
          { id: 'h_orca', kind: 'git' }
        ]
      }
    })
  })

  it('reads a selector the host does not know as no repo', async () => {
    const send = dispatcherWith({
      showRepo: async () => netsat,
      resolveOrchestrationWorkerServer: () => ({
        environmentId: 'env_m1',
        name: 'm1'
      }),
      callOrchestrationWorkerServer: async (_env: string, method: string) =>
        method === 'repo.list' ? { repos: [] } : Promise.reject(new Error('repo_not_found'))
    })

    await expect(send({ leadRepo: 'r_netsat', repo: 'name:x', on: 'm1' })).resolves.toMatchObject({
      result: { host: 'm1', repo: null, repos: [] }
    })
  })
})

describe('game.memberRepoScope for a fork lead (ORCA-1198)', () => {
  const leadFork = record('r_orca', 'orca-oss', 'github.com/stablyai/orca', 'upstream', 'ssh_box')
  const hostFork = record('h_orca', 'orca-oss', 'github.com/ab2webco/orca-oss')
  const hostOther = record('h_other', 'orca', 'github.com/stablyai/orca', 'upstream')

  const sendOnM1 = () =>
    dispatcherWith({
      showRepo: async () => leadFork,
      resolveOrchestrationWorkerServer: () => ({
        environmentId: 'env_m1',
        name: 'm1'
      }),
      callOrchestrationWorkerServer: async (_env: string, method: string) =>
        method === 'repo.list' ? { repos: [hostFork, hostOther] } : { repo: hostFork }
    })

  it("reads the lead's own remote where its identity names upstream", async () => {
    vi.mocked(detectGitOwnRemoteKey).mockResolvedValue('github.com/ab2webco/orca-oss')

    await expect(
      sendOnM1()({ leadRepo: 'r_orca', repo: 'name:orca-oss', on: 'm1' })
    ).resolves.toMatchObject({
      result: {
        lead: {
          remoteKey: 'github.com/stablyai/orca',
          ownRemoteKey: 'github.com/ab2webco/orca-oss'
        },
        repo: { ownRemoteKey: 'github.com/ab2webco/orca-oss' },
        repos: [
          { id: 'h_orca', ownRemoteKey: 'github.com/ab2webco/orca-oss' },
          // Why null: a host repo named by its upstream could be any fork of it.
          {
            id: 'h_other',
            remoteKey: 'github.com/stablyai/orca',
            ownRemoteKey: null
          }
        ]
      }
    })
    expect(detectGitOwnRemoteKey).toHaveBeenCalledWith('/work/orca-oss', 'ssh_box')
  })

  it('reads no own remote for the lead when its remotes cannot be read', async () => {
    vi.mocked(detectGitOwnRemoteKey).mockResolvedValue(null)

    await expect(
      sendOnM1()({ leadRepo: 'r_orca', repo: 'name:orca-oss', on: 'm1' })
    ).resolves.toMatchObject({ result: { lead: { ownRemoteKey: null } } })
  })

  it('probes nothing for a lead whose identity is already its own remote', async () => {
    const send = dispatcherWith({
      showRepo: async (selector: string) =>
        localRepos[selector] ?? Promise.reject(new Error('repo_not_found'))
    })

    await send({ leadRepo: 'r_netsat', repo: 'name:orca-oss' })
    expect(detectGitOwnRemoteKey).not.toHaveBeenCalled()
  })
})
