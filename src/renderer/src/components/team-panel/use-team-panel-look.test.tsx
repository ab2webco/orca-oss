// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let settings: {
  orchestratorGame?: OrchestratorGameLayer
  orchestratorGameProjects?: Record<string, OrchestratorGameLayer>
} = {}
let repo: { id: string; kind: string; connectionId: string | null } = {
  id: 'repo-1',
  kind: 'git',
  connectionId: null
}
const storeState = (): Record<string, unknown> => ({
  settings,
  activeWorktreeId: 'wt-1',
  activeWorkspaceExecutionHostId: null,
  repos: [repo],
  getKnownWorktreeById: () => ({ repoId: 'repo-1' })
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(storeState()),
    { getState: storeState }
  )
}))
const checkRuntimeHooks = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-hooks-client', () => ({ checkRuntimeHooks }))

const { resetTeamPanelProjectLayers, useTeamPanelLook } = await import('./use-team-panel-look')

const yaml = (orchestratorGame: OrchestratorGameLayer | undefined) =>
  checkRuntimeHooks.mockResolvedValue({
    hasHooks: true,
    hooks: { orchestratorGame },
    mayNeedUpdate: false
  })

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
})
beforeEach(() => {
  settings = {}
  repo = { id: 'repo-1', kind: 'git', connectionId: null }
  checkRuntimeHooks.mockReset()
  yaml(undefined)
  resetTeamPanelProjectLayers()
})

async function looks(count = 1): Promise<string[]> {
  const seen: string[] = []
  function Probe(): null {
    seen.push(useTeamPanelLook())
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () =>
    root.render(
      <>
        {Array.from({ length: count }, (_, i) => (
          <Probe key={i} />
        ))}
      </>
    )
  )
  await act(async () => {})
  return seen.slice(-count)
}

describe('useTeamPanelLook', () => {
  it('reads the global panel look', async () => {
    settings = { orchestratorGame: { panel: { look: 'plain' } } }

    expect(await looks()).toEqual(['plain'])
  })

  it("lets the project's orca.yaml override the global look", async () => {
    settings = { orchestratorGame: { panel: { look: 'plain' } } }
    yaml({ panel: { look: 'display' } })

    expect(await looks()).toEqual(['display'])
  })

  it("lets this machine's project override beat orca.yaml", async () => {
    settings = { orchestratorGameProjects: { 'repo-1': { panel: { look: 'game' } } } }
    yaml({ panel: { look: 'display' } })

    expect(await looks()).toEqual(['game'])
  })

  // Why: a project set to the old `flat` mode, with no look yet, keeps the plain view it chose.
  it('follows the legacy mode when no layer sets a look', async () => {
    settings = { orchestratorGame: { mode: 'flat' } }

    expect(await looks()).toEqual(['plain'])
  })

  it('reads orca.yaml once for every panel part that asks', async () => {
    yaml({ panel: { look: 'display' } })

    expect(await looks(3)).toEqual(['display', 'display', 'display'])
    expect(checkRuntimeHooks).toHaveBeenCalledTimes(1)
  })

  // Why: a folder project has no orca.yaml to read.
  it('never reads orca.yaml for a folder project', async () => {
    repo = { id: 'repo-1', kind: 'folder', connectionId: null }
    settings = { orchestratorGame: { panel: { look: 'plain' } } }

    expect(await looks()).toEqual(['plain'])
    expect(checkRuntimeHooks).not.toHaveBeenCalled()
  })

  // Why: the project's orca.yaml lives on the project's host, whichever workspace is active.
  it("reads a remote project's orca.yaml on its own host", async () => {
    repo = { id: 'repo-1', kind: 'git', connectionId: 'box' }

    await looks()
    expect(checkRuntimeHooks.mock.calls.at(-1)?.slice(1)).toEqual(['repo-1', 'ssh:box'])
  })
})
