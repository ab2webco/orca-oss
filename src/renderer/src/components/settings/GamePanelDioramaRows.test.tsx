// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { GamePanelSetting, ProjectGamePanelRows } from './OrchestratorGamePanelSetting'

// Why never settles: the preview's art loads from assets happy-dom cannot decode.
vi.mock('../team-scene/team-scene-art-load', () => ({
  loadTeamSceneArt: vi.fn(() => new Promise(() => {}))
}))

function render(element: React.JSX.Element) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

function press(container: HTMLElement, group: string, label: string): void {
  const target = Array.from(
    container.querySelectorAll<HTMLElement>(`[aria-label="${group}"] button`)
  ).find((entry) => entry.textContent?.trim() === label)
  expect(target, `${group} ${label}`).toBeTruthy()
  act(() => target?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

const segments = (container: HTMLElement, group: string): string[] =>
  Array.from(container.querySelectorAll(`[aria-label="${group}"] [role="radio"]`)).map(
    (entry) => entry.textContent?.trim() ?? ''
  )

const diorama = { panel: { style: 'figures' as const, diorama: true } }

describe('the diorama rows in the panel settings', () => {
  it('offer quality and pace while Figures draws as the diorama, and store the pick', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <GamePanelSetting
        settings={{ orchestratorGame: diorama }}
        updateSettings={(next) => updates.push(next)}
      />
    )
    expect(segments(view.container, 'Scene quality')).toEqual(['Illustrated', 'Low resources'])
    expect(segments(view.container, "Lead's pace")).toEqual(['Normal', 'Fast', 'Direct'])
    press(view.container, 'Scene quality', 'Low resources')
    press(view.container, "Lead's pace", 'Direct')
    expect(updates).toEqual([
      { orchestratorGame: { panel: { ...diorama.panel, quality: 'low' } } },
      { orchestratorGame: { panel: { ...diorama.panel, pace: 'direct' } } }
    ])
    view.unmount()
  })

  it('hide outside the diorama: Pixel, Office, or Figures in 2D', () => {
    for (const panel of [
      { style: 'pixel' as const, diorama: true },
      { style: 'figures' as const, diorama: false }
    ]) {
      const view = render(
        <GamePanelSetting settings={{ orchestratorGame: { panel } }} updateSettings={() => {}} />
      )
      expect(view.container.querySelector('[aria-label="Scene quality"]')).toBeNull()
      view.unmount()
    }
  })

  it('preview Figures in 2D when the diorama gets no WebGL, as the panel draws it', () => {
    const view = render(
      <GamePanelSetting settings={{ orchestratorGame: diorama }} updateSettings={() => {}} />
    )
    const preview = view.container.querySelector('[data-slot="game-panel-style-preview"]')
    expect(preview?.getAttribute('data-style')).toBe('figures')
    expect(preview?.querySelector('[data-diorama-preview]')).toBeNull()
    view.unmount()
  })

  it("store this machine's pace for one project, and inherit it again", () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <ProjectGamePanelRows
        repoId="r1"
        settings={{
          orchestratorGame: diorama,
          orchestratorGameProjects: { r1: { panel: { pace: 'fast' } } }
        }}
        projectLayer={undefined}
        advisorPlugin="installed"
        updateSettings={(next) => updates.push(next)}
      />
    )
    expect(view.container.textContent).toContain('Fast · this machine')
    press(view.container, "Lead's pace", 'Inherit')
    press(view.container, 'Scene quality', 'Low resources')
    expect(updates).toEqual([
      { orchestratorGameProjects: {} },
      { orchestratorGameProjects: { r1: { panel: { pace: 'fast', quality: 'low' } } } }
    ])
    view.unmount()
  })
})
