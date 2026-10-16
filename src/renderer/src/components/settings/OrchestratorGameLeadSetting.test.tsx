// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { ProjectOrchestratorGameLeadSetting } from './OrchestratorGameLeadSetting'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>

function render(
  settings: GameSettings,
  projectLayer: OrchestratorGameLayer | undefined,
  updates: Partial<GlobalSettings>[] = []
): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ProjectOrchestratorGameLeadSetting
        repoId="repo1"
        settings={settings}
        projectLayer={projectLayer}
        updateSettings={(update) => updates.push(update)}
      />
    )
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
    (entry) => entry.textContent?.trim() === label
  )
  expect(target, label).toBeTruthy()
  act(() => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const field = (container: HTMLElement, label: string): HTMLInputElement => {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  expect(input, label).toBeTruthy()
  return input as HTMLInputElement
}

function commit(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

describe('ProjectOrchestratorGameLeadSetting', () => {
  it('shows each effective lead value with the layer it comes from', () => {
    const view = render(
      { orchestratorGameProjects: { repo1: { orchestrator: { label: 'Boss' } } } },
      { orchestrator: { autostart: true, cap: 6 } }
    )

    const text = view.container.textContent ?? ''
    expect(text).toContain('Lead')
    expect(text).toContain('On · from orca.yaml')
    expect(text).toContain('6 · from orca.yaml')
    expect(text).toContain('Boss · this machine')
    expect(text).toContain('claude · default')
    expect(text).toContain('orchestratorGame.orchestrator')
    expect(field(view.container, 'Member cap').placeholder).toBe('6')
    view.unmount()
  })

  it('starts as lead on this machine, and inherits again', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({ orchestratorGameProjects: { repo1: { hud: false } } }, undefined, updates)
    click(view.container, '[aria-label="Start as lead"] button', 'On')
    view.unmount()

    const overridden = render(
      { orchestratorGameProjects: { repo1: { orchestrator: { autostart: true } } } },
      undefined,
      updates
    )
    click(overridden.container, '[aria-label="Start as lead"] button', 'Inherit')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { hud: false, orchestrator: { autostart: true } } } },
      { orchestratorGameProjects: {} }
    ])
    overridden.unmount()
  })

  it("turns Orca's lead buttons off on this machine, shown on by default", () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({}, undefined, updates)
    expect(view.container.textContent).toContain('Lead buttons')
    expect(view.container.textContent).toContain('On · default')
    click(view.container, '[aria-label="Lead buttons"] button', 'Off')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { orchestrator: { actions: false } } } }
    ])
    view.unmount()

    const fromYaml = render({}, { orchestrator: { actions: false } })
    expect(fromYaml.container.textContent).toContain('Off · from orca.yaml')
    fromYaml.unmount()
  })

  it('saves a typed value on blur and inherits when the field is cleared', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      { orchestratorGameProjects: { repo1: { orchestrator: { agent: 'codex' } } } },
      undefined,
      updates
    )

    commit(field(view.container, 'Model'), ' opus ')
    commit(field(view.container, 'Member cap'), '8')
    commit(field(view.container, 'Agent'), '')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { orchestrator: { agent: 'codex', model: 'opus' } } } },
      { orchestratorGameProjects: { repo1: { orchestrator: { agent: 'codex', cap: 8 } } } },
      { orchestratorGameProjects: {} }
    ])
    view.unmount()
  })

  it('refuses a value the lead would drop and says why', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({}, undefined, updates)

    commit(field(view.container, 'Member cap'), '40')
    commit(field(view.container, 'Agent'), 'Not An Agent')
    expect(updates).toEqual([])
    const alerts = Array.from(view.container.querySelectorAll('[role="alert"]')).map(
      (alert) => alert.textContent
    )
    expect(alerts).toEqual([
      'Enter a whole number from 1 to 12.',
      'Use an agent id like claude or codex.'
    ])
    expect(field(view.container, 'Member cap').getAttribute('aria-invalid')).toBe('true')
    view.unmount()
  })

  it('says an effort is used only with a model', () => {
    const view = render(
      { orchestratorGameProjects: { repo1: { orchestrator: { effort: 'high' } } } },
      undefined
    )
    expect(view.container.textContent).toContain('Used only with a model')
    view.unmount()
  })
})
