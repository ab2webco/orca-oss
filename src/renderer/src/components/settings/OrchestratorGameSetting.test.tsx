// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { PluginHostListEntry } from '../../../../preload/api/plugin-host-api'
import { usePluginPanelsStore } from '../../store/plugin-panels'
import { OrchestratorGameSetting, ProjectOrchestratorGameSetting } from './OrchestratorGameSetting'

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
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  )
}))

const spacePack: PluginHostListEntry = {
  pluginKey: 'acme.space',
  consentFingerprint: 'sha256-x',
  name: 'Space Pack',
  version: '1.0.0',
  publisher: 'acme',
  status: 'idle',
  needsReconsent: false,
  isDev: false,
  official: false,
  bundled: false,
  capabilities: [],
  panels: [],
  commands: [],
  hasWorker: false,
  restarts: 0,
  gameScenes: ['acme.space/orbit']
}

beforeEach(() => {
  usePluginPanelsStore.setState({ plugins: [spacePack], fetchStatus: 'ready' })
})

function sceneSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector('select')
  expect(select).toBeTruthy()
  return select as HTMLSelectElement
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const optionsOf = (select: HTMLSelectElement): [string, string][] =>
  Array.from(select.options).map((option) => [option.value, option.textContent ?? ''])

function render(node: React.ReactNode): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

function click(container: HTMLElement, selector: string, label: string): void {
  const target = Array.from(container.querySelectorAll<HTMLElement>(selector)).find(
    (entry) => (entry.textContent?.trim() || entry.getAttribute('aria-label')) === label
  )
  expect(target, label).toBeTruthy()
  act(() => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('OrchestratorGameSetting', () => {
  it('writes the global layer from the mode control and the switches', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <OrchestratorGameSetting
        settings={{ orchestratorGame: { rewards: false } }}
        updateSettings={(update) => updates.push(update)}
      />
    )

    click(view.container, 'button', 'Zen')
    click(view.container, '[role="switch"]', 'Teammate HUD')
    expect(updates).toEqual([
      { orchestratorGame: { rewards: false, mode: 'zen' } },
      { orchestratorGame: { rewards: false, hud: false } }
    ])
    view.unmount()
  })
})

describe('ProjectOrchestratorGameSetting', () => {
  it('shows where the effective value comes from and overrides it for this machine', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <ProjectOrchestratorGameSetting
        repoId="repo1"
        settings={{ orchestratorGameProjects: { repo1: { hud: false } } }}
        projectLayer={{ mode: 'off' }}
        updateSettings={(update) => updates.push(update)}
      />
    )

    expect(view.container.textContent).toContain('Off · from orca.yaml')
    expect(view.container.textContent).toContain('Off · this machine')

    click(view.container, '[aria-label="Game mode"] button', 'Zen')
    click(view.container, '[aria-label="Teammate HUD"] button', 'Inherit')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { hud: false, mode: 'zen' } } },
      { orchestratorGameProjects: {} }
    ])
    view.unmount()
  })
})

describe('game scene picker', () => {
  it('offers quest and the scenes of running plugins, and writes the pick globally', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <OrchestratorGameSetting settings={{}} updateSettings={(update) => updates.push(update)} />
    )

    const select = sceneSelect(view.container)
    expect(select.value).toBe('quest')
    expect(optionsOf(select)).toEqual([
      ['quest', 'Quest (built-in)'],
      ['acme.space/orbit', 'orbit · Space Pack']
    ])
    choose(select, 'acme.space/orbit')
    expect(updates).toEqual([{ orchestratorGame: { scene: 'acme.space/orbit' } }])
    view.unmount()
  })

  it('keeps a scene nothing installed serves selected and says so', () => {
    const view = render(
      <OrchestratorGameSetting
        settings={{ orchestratorGame: { scene: 'acme.gone/orbit' } }}
        updateSettings={() => undefined}
      />
    )

    const select = sceneSelect(view.container)
    expect(select.value).toBe('acme.gone/orbit')
    expect(optionsOf(select)).toContainEqual(['acme.gone/orbit', 'acme.gone/orbit (not installed)'])
    view.unmount()
  })

  it('shows the orca.yaml scene as-is and overrides or inherits it for this machine', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <ProjectOrchestratorGameSetting
        repoId="repo1"
        settings={{}}
        projectLayer={{ scene: 'acme.gone/orbit' }}
        updateSettings={(update) => updates.push(update)}
      />
    )

    expect(view.container.textContent).toContain('acme.gone/orbit · from orca.yaml')
    const select = sceneSelect(view.container)
    expect(select.value).toBe('inherit')
    choose(select, 'acme.space/orbit')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { scene: 'acme.space/orbit' } } }
    ])
    view.unmount()
  })
})
