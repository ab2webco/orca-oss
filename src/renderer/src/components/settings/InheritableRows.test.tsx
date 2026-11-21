// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { usePluginPanelsStore } from '../../store/plugin-panels'
import { ProjectOrchestratorGameSetting } from './OrchestratorGameSetting'

vi.mock('../team-scene/team-scene-art-load', () => ({
  loadTeamSceneArt: vi.fn(() => new Promise(() => {}))
}))

vi.mock('../ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children
  }: {
    value: string
    onValueChange: (value: string) => void
    children: React.ReactNode
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectSeparator: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  )
}))

beforeEach(() => {
  usePluginPanelsStore.setState({ plugins: [], fetchStatus: 'ready' })
  Object.assign(window, {
    api: {
      fs: {
        readDir: async () => [],
        readFile: async () => {
          throw new Error('ENOENT')
        }
      }
    }
  })
})

function renderProject(
  projectLayer: OrchestratorGameLayer | undefined,
  local: OrchestratorGameLayer | undefined = undefined
): { container: HTMLDivElement; updates: Partial<GlobalSettings>[]; unmount: () => void } {
  const updates: Partial<GlobalSettings>[] = []
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ProjectOrchestratorGameSetting
        repo={{ id: 'repo1', path: '/repo', connectionId: null }}
        settings={local ? { orchestratorGameProjects: { repo1: local } } : {}}
        projectLayer={projectLayer}
        updateSettings={(next) => updates.push(next)}
      />
    )
  })
  return {
    container,
    updates,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

const EVERYTHING: OrchestratorGameLayer = {
  mode: 'on',
  render: 'hd',
  band: true,
  panel: { look: 'game', style: 'figures' }
}

const rowOf = (root: HTMLElement, id: string): HTMLElement =>
  root.querySelector<HTMLElement>(`[data-game-row="${id}"]`)!
const checkedIn = (row: HTMLElement): string | null =>
  row.querySelector('[role="radio"][aria-checked="true"]')?.textContent ?? null
const press = (target: Element): void =>
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
const radio = (row: HTMLElement, label: string): HTMLElement =>
  Array.from(row.querySelectorAll<HTMLElement>('[role="radio"]')).find(
    (one) => one.textContent === label
  )!

describe('inherited project rows show the applied value (ORCA-1112 D3)', () => {
  it('offers no Inherit option anywhere on the project page', () => {
    const view = renderProject(EVERYTHING)
    const choices = [
      ...view.container.querySelectorAll('[role="radio"]'),
      ...view.container.querySelectorAll('option')
    ].map((one) => one.textContent)

    expect(choices).not.toContain('Inherit')
    view.unmount()
  })

  it('selects the value orca.yaml applies', () => {
    const view = renderProject({ ...EVERYTHING, rewards: false })

    expect(checkedIn(rowOf(view.container, 'band'))).toBe('On')
    expect(checkedIn(rowOf(view.container, 'rewards'))).toBe('Off')
    expect(checkedIn(rowOf(view.container, 'render'))).toBe('HD')
    expect(checkedIn(rowOf(view.container, 'look'))).toBe('Game')
    view.unmount()
  })

  it('ends every row that has a control with one source line in the same place', () => {
    const view = renderProject(EVERYTHING)
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[data-game-row]')).filter(
      (row) => !['stylePreview', 'bandPreview'].includes(row.dataset.gameRow ?? '')
    )

    for (const row of rows) {
      const lines = row.querySelectorAll('[data-slot="game-row-source"]')
      expect(lines.length, row.dataset.gameRow).toBeGreaterThanOrEqual(1)
    }
    view.unmount()
  })

  it('picking the inherited value clears the override instead of storing a copy', () => {
    const view = renderProject(EVERYTHING, { render: 'classic' })

    expect(checkedIn(rowOf(view.container, 'render'))).toBe('Classic')
    press(radio(rowOf(view.container, 'render'), 'HD'))
    expect(view.updates).toEqual([{ orchestratorGameProjects: {} }])
    view.unmount()
  })

  it('offers Reset only while this machine overrides the row, as a keyboard button', () => {
    const view = renderProject(EVERYTHING, { rewards: false })
    const reset = (id: string) =>
      rowOf(view.container, id).querySelector<HTMLButtonElement>(
        '[data-slot="game-row-source"] button'
      )

    expect(reset('tracker')).toBeNull()
    const button = reset('rewards')!
    expect(button.textContent).toBe('Reset to On (default)')
    expect(button.type).toBe('button')
    expect(button.tabIndex).toBeGreaterThanOrEqual(0)
    press(button)
    expect(view.updates).toEqual([{ orchestratorGameProjects: {} }])
    view.unmount()
  })

  it('in Flat, Off after an On that stored the band clears both, leaving no hidden band:true', () => {
    const view = renderProject({ mode: 'flat' }, { hud: true, band: true })
    const hud = rowOf(view.container, 'hud')

    expect(checkedIn(hud)).toBe('On')
    press(radio(hud, 'Off'))
    expect(view.updates).toEqual([{ orchestratorGameProjects: {} }])
    view.unmount()
  })

  it('in Flat, the HUD Reset gives back the real default Off and clears the band it wrote', () => {
    const view = renderProject({ mode: 'flat' }, { hud: true, band: true })
    const reset = rowOf(view.container, 'hud').querySelector<HTMLButtonElement>(
      '[data-slot="game-row-source"] button'
    )!

    expect(reset.textContent).toBe('Reset to Off (default)')
    press(reset)
    expect(view.updates).toEqual([{ orchestratorGameProjects: {} }])
    view.unmount()
  })

  it('selects the applied view and scene in their menus, with no Inherit entry', () => {
    const view = renderProject({ mode: 'zen', scene: 'jrpg', panel: { look: 'game' } })
    const selects = Array.from(view.container.querySelectorAll('select'))

    expect(selects.map((one) => one.value)).toEqual(expect.arrayContaining(['zen', 'jrpg']))
    view.unmount()
  })

  it('gives the Lead switches the same treatment', () => {
    const view = renderProject(undefined)
    const lead = view.container.querySelector<HTMLElement>('[data-slot="game-lead-settings"]')!

    expect(
      Array.from(lead.querySelectorAll('[role="radio"]')).map((one) => one.textContent)
    ).not.toContain('Inherit')
    expect(lead.querySelectorAll('[data-slot="game-row-source"]').length).toBeGreaterThan(0)
    view.unmount()
  })
})
