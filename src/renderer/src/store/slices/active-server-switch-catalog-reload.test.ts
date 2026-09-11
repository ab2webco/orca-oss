import { expect, it, vi } from 'vitest'
import {
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../../shared/protocol-version'
import { createTestStore } from './store-test-helpers'

function compatibleStatus(runtimeId: string) {
  return {
    ok: true,
    result: {
      runtimeId,
      graphStatus: 'ready',
      runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
      minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION
    },
    _meta: { runtimeId }
  }
}

function stubWindow(): void {
  vi.stubGlobal('window', {
    api: {
      settings: {
        setActiveRuntimeEnvironmentPreference: vi.fn(
          ({ environmentId }: { environmentId: string | null }) =>
            Promise.resolve({ activeRuntimeEnvironmentId: environmentId })
        )
      },
      runtimeEnvironments: {
        getStatus: vi.fn().mockResolvedValue(compatibleStatus('runtime-remote')),
        call: vi.fn().mockResolvedValue({
          ok: true,
          result: { settings: {} },
          _meta: { runtimeId: 'runtime-remote' }
        })
      }
    }
  })
}

function catalogSpies() {
  return {
    fetchRepos: vi.fn().mockResolvedValue(undefined),
    fetchProjectGroups: vi.fn().mockResolvedValue(undefined),
    fetchFolderWorkspaces: vi.fn().mockResolvedValue(undefined),
    fetchAllWorktrees: vi.fn().mockResolvedValue(undefined),
    fetchWorktreeLineage: vi.fn().mockResolvedValue(undefined),
    fetchBrowserSessionProfiles: vi.fn().mockResolvedValue(undefined)
  }
}

// ORCA-467: cambiar el Active Server recargaba repos y worktrees pero NUNCA los
// project groups ni los folder workspaces, asi que el sidebar seguia mostrando
// solo los del host anterior y el servidor parecia vacio.
it('reloads the project-group and folder-workspace catalogs when the Active Server changes', async () => {
  stubWindow()
  const store = createTestStore()
  const spies = catalogSpies()
  store.setState({ settings: { activeRuntimeEnvironmentId: null } as never, ...spies })

  await store.getState().setActiveRuntimeEnvironmentPreference('env-1')

  expect(spies.fetchProjectGroups).toHaveBeenCalledOnce()
  expect(spies.fetchFolderWorkspaces).toHaveBeenCalledOnce()
})

it('reloads both catalogs on the way back to Local', async () => {
  stubWindow()
  const store = createTestStore()
  const spies = catalogSpies()
  store.setState({ settings: { activeRuntimeEnvironmentId: 'env-1' } as never, ...spies })

  await store.getState().setActiveRuntimeEnvironmentPreference(null)

  expect(spies.fetchProjectGroups).toHaveBeenCalledOnce()
  expect(spies.fetchFolderWorkspaces).toHaveBeenCalledOnce()
})
