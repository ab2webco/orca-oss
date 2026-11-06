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
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settings,
      activeWorktreeId,
      getKnownWorktreeById: () => ({ repoId: 'repo-1' })
    })
}))

const { useTeamSceneStyle } = await import('./use-team-scene-style')

function styleNow(): string {
  let seen = ''
  function Probe(): null {
    seen = useTeamSceneStyle()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  act(() => root.unmount())
  return seen
}

describe('useTeamSceneStyle', () => {
  beforeEach(() => {
    settings = {}
    activeWorktreeId = 'wt-1'
  })

  it('draws Pixel when no layer sets a style', () => {
    expect(styleNow()).toBe('pixel')
  })

  it('reads the style from global Settings', () => {
    settings = { orchestratorGame: { panel: { style: 'office' } } }
    expect(styleNow()).toBe('office')
  })

  it("lets this machine's choice for the project win over the global one", () => {
    settings = {
      orchestratorGame: { panel: { style: 'office' } },
      orchestratorGameProjects: { 'repo-1': { panel: { style: 'figures' } } }
    }
    expect(styleNow()).toBe('figures')
  })

  it('keeps the global style with no active project', () => {
    activeWorktreeId = null
    settings = {
      orchestratorGame: { panel: { style: 'office' } },
      orchestratorGameProjects: { 'repo-1': { panel: { style: 'figures' } } }
    }
    expect(styleNow()).toBe('office')
  })

  it('draws Pixel before settings have loaded', () => {
    settings = null
    expect(styleNow()).toBe('pixel')
  })
})
