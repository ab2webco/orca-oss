// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let settings: {
  orchestratorGame?: OrchestratorGameLayer
  orchestratorGameProjects?: Record<string, OrchestratorGameLayer>
} | null = null
let activeWorktreeId: string | null = 'wt-1'
const storeState = (): Record<string, unknown> => ({
  settings,
  activeWorktreeId,
  repos: [{ id: 'repo-1', kind: 'git', connectionId: null }],
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

const { useTeamSceneStyle } = await import('./use-team-scene-style')
const { useTeamPanelLook } = await import('../team-panel/use-team-panel-look')
const { resetTeamPanelProjectLayers } = await import('../team-panel/team-panel-setting-layers')

const yaml = (orchestratorGame: OrchestratorGameLayer | undefined) =>
  checkRuntimeHooks.mockResolvedValue({ hasHooks: true, hooks: { orchestratorGame } })

async function styleNow(): Promise<string> {
  let seen = ''
  function Probe(): null {
    seen = useTeamSceneStyle()
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
  await act(async () => {})
  act(() => root.unmount())
  return seen
}

describe('useTeamSceneStyle', () => {
  beforeEach(() => {
    settings = {}
    activeWorktreeId = 'wt-1'
    checkRuntimeHooks.mockReset()
    yaml(undefined)
    resetTeamPanelProjectLayers()
  })

  it('draws Pixel when no layer sets a style', async () => {
    expect(await styleNow()).toBe('pixel')
  })

  it('reads the style from global Settings', async () => {
    settings = { orchestratorGame: { panel: { style: 'office' } } }
    expect(await styleNow()).toBe('office')
  })

  it("applies a style set only in the project's orca.yaml", async () => {
    yaml({ panel: { style: 'figures' } })
    expect(await styleNow()).toBe('figures')
  })

  it("lets this machine's choice for the project win over orca.yaml and global", async () => {
    settings = {
      orchestratorGame: { panel: { style: 'office' } },
      orchestratorGameProjects: { 'repo-1': { panel: { style: 'figures' } } }
    }
    yaml({ panel: { style: 'office' } })
    expect(await styleNow()).toBe('figures')
  })

  it('keeps the global style with no active project', async () => {
    activeWorktreeId = null
    settings = {
      orchestratorGame: { panel: { style: 'office' } },
      orchestratorGameProjects: { 'repo-1': { panel: { style: 'figures' } } }
    }
    expect(await styleNow()).toBe('office')
    expect(checkRuntimeHooks).not.toHaveBeenCalled()
  })

  it('draws Pixel before settings have loaded', async () => {
    settings = null
    expect(await styleNow()).toBe('pixel')
  })

  // Why: the scene and the panel look come from the same orca.yaml, so one read serves both.
  it('shares one orca.yaml read with the panel look', async () => {
    yaml({ panel: { style: 'office', look: 'display' } })
    const seen: string[] = []
    function Probe(): null {
      seen.push(`${useTeamPanelLook()}/${useTeamSceneStyle()}`)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Probe />))
    await act(async () => {})
    act(() => root.unmount())
    expect(seen.at(-1)).toBe('display/office')
    expect(checkRuntimeHooks).toHaveBeenCalledTimes(1)
  })
})
