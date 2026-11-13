// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { GamePanelSetting, ProjectGamePanelRows } from './OrchestratorGamePanelSetting'
import type { AdvisorPluginPresence } from './use-advisor-plugin-presence'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>

function render(element: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
} {
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

function toggle(container: HTMLElement, label: string): void {
  const target = container.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`)
  expect(target, label).toBeTruthy()
  act(() => target?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

const segments = (container: HTMLElement, group: string): string[] =>
  Array.from(container.querySelectorAll(`[aria-label="${group}"] [role="radio"]`)).map(
    (entry) => entry.textContent?.trim() ?? ''
  )

const selected = (container: HTMLElement, group: string): string | null | undefined =>
  container
    .querySelector(`[aria-label="${group}"] [role="radio"][aria-checked="true"]`)
    ?.textContent?.trim()

// Why parsed: Soft is no longer in the type, but a settings file can still say it.
const savedSoft = JSON.parse('{"panel":{"style":"soft"}}') as OrchestratorGameLayer

describe('GamePanelSetting', () => {
  it('offers only the scene styles something draws', () => {
    const view = render(<GamePanelSetting settings={{}} updateSettings={() => {}} />)

    expect(segments(view.container, 'Scene style')).toEqual(['Figures', 'Office', 'Pixel'])
    view.unmount()
  })

  // ORCA-1139, ORCA-1150: vigilante has no Office art, so the panel draws Orca's own office.
  it("says when the scene has no Office art, so the panel draws Orca's own office", () => {
    const view = render(
      <GamePanelSetting
        settings={{ orchestratorGame: { scene: 'vigilante', panel: { style: 'office' } } }}
        updateSettings={() => {}}
      />
    )

    expect(view.container.textContent).toContain(
      "This scene has no Office art, so the Team panel draws Orca's own office."
    )
    view.unmount()
  })

  it('shows a saved soft as Pixel', () => {
    const view = render(
      <GamePanelSetting settings={{ orchestratorGame: savedSoft }} updateSettings={() => {}} />
    )

    expect(selected(view.container, 'Scene style')).toBe('Pixel')
    view.unmount()
  })

  it('is the global Panel section the gear targets, with look, style and the three tabs', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <GamePanelSetting
        settings={{ orchestratorGame: { scene: 'quest' } }}
        updateSettings={(next) => updates.push(next)}
      />
    )

    expect(view.container.querySelector('#agents-game-panel')).toBeTruthy()
    expect(view.container.textContent).toContain('Same data and actions in all three.')
    expect(view.container.textContent).not.toContain('Advisor')
    expect(view.container.textContent).not.toContain('Arcade')
    press(view.container, 'Scene style', 'Figures')
    toggle(view.container, 'Show Queue')
    expect(updates).toEqual([
      { orchestratorGame: { scene: 'quest', panel: { style: 'figures' } } },
      {
        orchestratorGame: { scene: 'quest', panel: { tabs: { queue: false } } }
      }
    ])
    view.unmount()
  })

  it('hides the scene style outside the Game look', () => {
    const view = render(
      <GamePanelSetting
        settings={{ orchestratorGame: { panel: { look: 'plain' } } }}
        updateSettings={() => {}}
      />
    )

    expect(view.container.querySelector('[aria-label="Scene style"]')).toBeNull()
    view.unmount()
  })
})

describe('ProjectGamePanelRows', () => {
  const projectRows = (
    settings: GameSettings,
    projectLayer?: OrchestratorGameLayer,
    advisorPlugin: AdvisorPluginPresence = 'installed'
  ) => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <ProjectGamePanelRows
        repoId="r1"
        settings={settings}
        projectLayer={projectLayer}
        advisorPlugin={advisorPlugin}
        updateSettings={(next) => updates.push(next)}
      />
    )
    return { ...view, updates }
  }

  it("stores this machine's choice for the repo and inherits it again", () => {
    const view = projectRows({
      orchestratorGameProjects: { r1: { panel: { advisor: false } } }
    })

    press(view.container, 'Panel look', 'Display')
    press(view.container, 'Advisor', 'Inherit')
    expect(view.updates).toEqual([
      {
        orchestratorGameProjects: {
          r1: { panel: { advisor: false, look: 'display' } }
        }
      },
      { orchestratorGameProjects: {} }
    ])
    view.unmount()
  })

  it('offers only the scene styles something draws, plus Inherit', () => {
    const view = projectRows({})

    expect(segments(view.container, 'Scene style')).toEqual([
      'Inherit',
      'Figures',
      'Office',
      'Pixel'
    ])
    view.unmount()
  })

  it("shows a saved soft as this machine's Pixel, over a global Figures", () => {
    const view = projectRows({
      orchestratorGame: { panel: { style: 'figures' } },
      orchestratorGameProjects: { r1: savedSoft }
    })

    expect(selected(view.container, 'Scene style')).toBe('Pixel')
    expect(view.container.textContent).toContain('Pixel · this machine')
    view.unmount()
  })

  it("warns about the project's scene only when it lacks the chosen style's art", () => {
    const local = { orchestratorGameProjects: { r1: { panel: { style: 'figures' as const } } } }
    const vigilante = projectRows(local, { scene: 'vigilante' })
    expect(vigilante.container.textContent).toContain(
      "This scene has no Figures art, so the Team panel draws the scene's own characters in Pixel."
    )
    vigilante.unmount()
    const quest = projectRows(local, { scene: 'quest' })
    expect(quest.container.textContent).not.toContain('default art')
    quest.unmount()
  })

  it('says what each row resolves to and which layer set it', () => {
    const view = projectRows(
      { orchestratorGame: { panel: { tabs: { prs: false } } } },
      { panel: { look: 'game', style: 'office' } }
    )

    expect(view.container.textContent).toContain('Office · from orca.yaml')
    expect(view.container.textContent).toContain('Off · global setting')
    expect(view.container.textContent).toContain('Row under the lead.')
    view.unmount()
  })

  it('shows the scene style and arcade only in the Game look', () => {
    const view = projectRows({}, { panel: { look: 'display' } })

    expect(view.container.querySelector('[aria-label="Scene style"]')).toBeNull()
    expect(view.container.querySelector('[aria-label="Arcade"]')).toBeNull()
    expect(view.container.querySelector('[aria-label="Advisor"]')).toBeTruthy()
    view.unmount()
  })

  it('hides the Advisor row only when the host says the plugin is missing', () => {
    const shown = (presence: AdvisorPluginPresence): boolean => {
      const view = projectRows({}, undefined, presence)
      const row = view.container.querySelector('[aria-label="Advisor"]') !== null
      view.unmount()
      return row
    }

    expect(shown('installed')).toBe(true)
    expect(shown('unknown')).toBe(true)
    expect(shown('missing')).toBe(false)
  })
})
