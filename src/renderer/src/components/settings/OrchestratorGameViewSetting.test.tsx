// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { ORCHESTRATOR_GAME_VIEWS } from '../../../../shared/orchestrator-game-view'
import {
  OrchestratorGameViewRows,
  orchestratorGameViewOptions,
  ProjectOrchestratorGameViewRows
} from './OrchestratorGameViewSetting'

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

function choose(container: HTMLElement, value: string): void {
  const select = container.querySelector('select') as HTMLSelectElement
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
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

const optionsOf = (container: HTMLElement): [string, string][] =>
  Array.from((container.querySelector('select') as HTMLSelectElement).options).map((option) => [
    option.value,
    option.textContent ?? ''
  ])

describe('the default view options', () => {
  it('are the shared view table, in its order, each with its cost', () => {
    expect(orchestratorGameViewOptions().map((one) => one.value)).toEqual(
      ORCHESTRATOR_GAME_VIEWS.map((view) => view.id)
    )
    expect(orchestratorGameViewOptions().map((one) => one.label)).toEqual([
      'Off · light',
      'Flat · light',
      'Zen · medium',
      '2D classic · medium',
      '2D hd · heavy'
    ])
  })
})

describe('Show the game and the default view, globally', () => {
  it('stores the default view as mode and render, keeping an hd-compact look and Show the game', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <OrchestratorGameViewRows
        settings={{ orchestratorGame: { render: 'hd-compact', show: false } }}
        updateSettings={(update) => updates.push(update)}
      />
    )

    expect(optionsOf(view.container).map(([value]) => value)).toEqual([
      'off',
      'flat',
      'zen',
      '2d-classic',
      '2d-hd'
    ])
    expect((view.container.querySelector('select') as HTMLSelectElement).value).toBe('2d-hd')
    choose(view.container, 'flat')
    choose(view.container, '2d-hd')
    click(view.container, '[role="switch"]', 'Show the game')
    expect(updates).toEqual([
      { orchestratorGame: { render: 'hd-compact', show: false, mode: 'flat' } },
      { orchestratorGame: { render: 'hd-compact', show: false, mode: 'on' } },
      { orchestratorGame: { render: 'hd-compact', show: true } }
    ])
    view.unmount()
  })
})

describe('Show the game and the default view, per project', () => {
  it('shows each effective value with its layer and overrides or inherits it on this machine', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <ProjectOrchestratorGameViewRows
        repoId="repo1"
        settings={{
          orchestratorGame: { mode: 'zen', show: false },
          orchestratorGameProjects: { repo1: { render: 'hd' } }
        }}
        projectLayer={{ mode: 'on' }}
        updateSettings={(update) => updates.push(update)}
      />
    )

    expect(view.container.textContent).toContain('Off · global setting')
    expect(view.container.textContent).toContain('2D hd · this machine')
    expect(optionsOf(view.container)[0]).toEqual(['inherit', 'Inherit'])
    expect((view.container.querySelector('select') as HTMLSelectElement).value).toBe('inherit')

    choose(view.container, 'zen')
    click(view.container, '[aria-label="Show the game"] button', 'On')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { render: 'hd', mode: 'zen' } } },
      { orchestratorGameProjects: { repo1: { render: 'hd', show: true } } }
    ])
    view.unmount()
  })

  it('inherits the view by dropping both keys that store it', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <ProjectOrchestratorGameViewRows
        repoId="repo1"
        settings={{
          orchestratorGameProjects: { repo1: { mode: 'flat', render: 'hd', hud: false } }
        }}
        projectLayer={undefined}
        updateSettings={(update) => updates.push(update)}
      />
    )

    expect((view.container.querySelector('select') as HTMLSelectElement).value).toBe('flat')
    expect(view.container.textContent).toContain('Flat · this machine')
    choose(view.container, 'inherit')
    expect(updates).toEqual([{ orchestratorGameProjects: { repo1: { hud: false } } }])
    view.unmount()
  })
})
