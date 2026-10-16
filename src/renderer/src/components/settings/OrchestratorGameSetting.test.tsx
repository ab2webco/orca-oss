// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { OrchestratorGameSetting, ProjectOrchestratorGameSetting } from './OrchestratorGameSetting'

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
