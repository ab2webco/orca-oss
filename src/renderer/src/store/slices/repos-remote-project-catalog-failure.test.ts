import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from './store-test-helpers'
import type { Project, ProjectHostSetup } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from '../../runtime/runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'

// ORCA-467: con el Active Server en un servidor remoto, un fallo de `project.list`
// se disfrazaba de catalogo sano — la proyeccion derivada de repos salia por el
// mismo `catch` que existe para runtimes viejos, y la UI mostraba proyectos que
// nadie le pidio al servidor.
const localRepo: Repo = {
  id: 'local-repo',
  path: '/local/orca',
  displayName: 'orca',
  badgeColor: '#22c55e',
  addedAt: 1
}

const remoteRepo: Repo = {
  id: 'remote-repo',
  path: '/home/fabolivar/orca-oss',
  displayName: 'orca-oss',
  badgeColor: '#737373',
  addedAt: 2
}

const localProject: Project = {
  id: 'local-project',
  displayName: 'orca',
  badgeColor: '#22c55e',
  sourceRepoIds: ['local-repo'],
  createdAt: 1,
  updatedAt: 1
}

const localSetup: ProjectHostSetup = {
  id: 'local-setup',
  projectId: 'local-project',
  hostId: 'local',
  repoId: 'local-repo',
  path: '/local/orca',
  displayName: 'orca',
  setupState: 'ready',
  setupMethod: 'imported-existing-folder',
  createdAt: 1,
  updatedAt: 1
}

const reposList = vi.fn()
const projectsList = vi.fn()
const listHostSetups = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()
let failRemoteProjectList = true

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  failRemoteProjectList = true
  reposList.mockReset().mockImplementation(async () => [structuredClone(localRepo)])
  projectsList.mockReset().mockImplementation(async () => [structuredClone(localProject)])
  listHostSetups.mockReset().mockImplementation(async () => [structuredClone(localSetup)])
  runtimeEnvironmentTransportCall
    .mockReset()
    .mockImplementation((args: RuntimeEnvironmentCallRequest) => {
      const compatible = createCompatibleRuntimeStatusResponseIfNeeded(args)
      if (compatible) {
        return compatible
      }
      if (args.method === 'repo.list') {
        return {
          id: 'rpc-repo',
          ok: true,
          result: { repos: [structuredClone(remoteRepo)] },
          _meta: { runtimeId: 'runtime-remote' }
        }
      }
      if (args.method === 'project.list' && failRemoteProjectList) {
        // Lo que de verdad pasa contra un servidor por Tailscale: el transporte
        // se cae o el RPC vence, no que el runtime no sepa del metodo.
        throw new Error('runtime request timed out')
      }
      if (args.method === 'project.list') {
        return {
          id: 'rpc-project',
          ok: true,
          result: { projects: [] },
          _meta: { runtimeId: 'runtime-remote' }
        }
      }
      if (args.method === 'projectHostSetup.list') {
        return {
          id: 'rpc-setup',
          ok: true,
          result: { setups: [] },
          _meta: { runtimeId: 'runtime-remote' }
        }
      }
      return { id: `rpc-${args.method}`, ok: true, result: {}, _meta: {} }
    })

  vi.stubGlobal('window', {
    api: {
      repos: { list: reposList },
      projects: { list: projectsList, listHostSetups },
      projectGroups: { list: vi.fn().mockResolvedValue([]) },
      folderWorkspaces: { list: vi.fn().mockResolvedValue([]) },
      runtimeEnvironments: {
        call: runtimeEnvironmentTransportCall,
        list: vi.fn().mockResolvedValue([{ id: 'env-1', name: 'orca-contabo' }])
      }
    },
    dispatchEvent: vi.fn()
  })
})

describe('remote project catalog failure (ORCA-467)', () => {
  it('does not invent projects for a host whose project.list failed', async () => {
    const store = createTestStore()
    store.setState({ settings: { activeRuntimeEnvironmentId: null } as never })
    await store.getState().fetchRepos()
    expect(store.getState().projects.map((project) => project.id)).toEqual(['local-project'])

    await store.getState().fetchRuntimeEnvironmentRepos('env-1')

    // Nada derivado del repo remoto: la proyeccion transitoria es la respuesta
    // para un runtime que NO sabe responder, no para uno que respondio mal.
    expect(store.getState().projects.filter((project) => project.id !== 'local-project')).toEqual(
      []
    )
    expect(
      store.getState().projectHostSetups.filter((setup) => setup.repoId === 'remote-repo')
    ).toEqual([])
  })

  it('keeps the local projects intact when the remote project catalog fails', async () => {
    const store = createTestStore()
    store.setState({ settings: { activeRuntimeEnvironmentId: null } as never })
    await store.getState().fetchRepos()
    const before = store.getState().projects

    await store.getState().fetchRuntimeEnvironmentRepos('env-1')

    // El fallo es de un host; borrar las filas del otro seria cambiar un bug por otro.
    expect(store.getState().projects).toEqual(before)
    expect(store.getState().projectHostSetups.map((setup) => setup.id)).toContain('local-setup')
  })

  it('still merges the remote repos — a project.list timeout must not hide the host', async () => {
    const store = createTestStore()
    store.setState({ settings: { activeRuntimeEnvironmentId: null } as never })
    await store.getState().fetchRepos()

    await store.getState().fetchRuntimeEnvironmentRepos('env-1')

    expect(
      store
        .getState()
        .repos.map((repo) => repo.id)
        .sort()
    ).toEqual(['local-repo', 'remote-repo'])
  })

  it('accepts the remote catalog once project.list answers', async () => {
    const store = createTestStore()
    store.setState({ settings: { activeRuntimeEnvironmentId: null } as never })
    await store.getState().fetchRepos()
    failRemoteProjectList = false

    await store.getState().fetchRuntimeEnvironmentRepos('env-1')

    expect(
      store
        .getState()
        .repos.map((repo) => repo.id)
        .sort()
    ).toEqual(['local-repo', 'remote-repo'])
  })
})
