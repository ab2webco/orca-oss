// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { ProjectOrchestratorGameLeadSetting } from './OrchestratorGameLeadSetting'
import type { GameHostProfile } from '../../../../shared/orchestrator-game-lead'

let host: GameHostProfile | null = null
vi.mock('./use-game-host-profile', () => ({ useGameHostProfile: () => host }))
afterEach(() => {
  host = null
})

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
  it('shows the cap this machine sets when no layer sets one', () => {
    host = { totalMemory: 64 * 1024 ** 3, cpuCoreCount: 12 }
    const view = render({}, undefined)

    expect(view.container.textContent).toContain('6 · default')
    expect(field(view.container, 'Member cap').placeholder).toBe('6')
    view.unmount()
  })

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

  it('turns the game off in member panes on this machine, on by default', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({}, undefined, updates)
    expect(view.container.textContent).toContain('Game in member panes')
    click(view.container, '[aria-label="Game in member panes"] button', 'Off')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { orchestrator: { memberGame: false } } } }
    ])
    view.unmount()

    const offInYaml = render({}, { orchestrator: { memberGame: false } })
    expect(offInYaml.container.textContent).toContain('Off · from orca.yaml')
    offInYaml.unmount()
  })

  it('keeps asking before resuming paused members on this machine, off by default', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({}, undefined, updates)
    expect(view.container.textContent).toContain('Ask before resuming')
    click(view.container, '[aria-label="Ask before resuming"] button', 'On')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { orchestrator: { askBeforeResume: true } } } }
    ])
    view.unmount()

    const fromYaml = render({}, { orchestrator: { askBeforeResume: true } })
    expect(fromYaml.container.textContent).toContain('On · from orca.yaml')
    fromYaml.unmount()

    const offInYaml = render({}, { orchestrator: { askBeforeResume: false } })
    expect(offInYaml.container.textContent).toContain('Off · from orca.yaml')
    offInYaml.unmount()
  })

  it('spreads members over accounts automatically on this machine, default unless set', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({}, undefined, updates)
    expect(view.container.textContent).toContain('Member accounts')
    expect(view.container.textContent).toContain("Orca's account · default")
    click(view.container, '[aria-label="Member accounts"] button', 'Most free')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { orchestrator: { accounts: 'auto' } } } }
    ])
    view.unmount()

    const fromYaml = render({}, { orchestrator: { accounts: 'auto' } })
    expect(fromYaml.container.textContent).toContain('Most free quota · from orca.yaml')
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

  it("saves member names typed with commas over the scene's, and inherits when cleared", () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      { orchestratorGameProjects: { repo1: { orchestrator: { memberNames: ['Ann'] } } } },
      { orchestrator: { memberNames: ['Mario', { en: 'Peach', es: 'Melocotón' }] } },
      updates
    )

    const names = field(view.container, 'Member names')
    expect(names.value).toBe('Ann')
    expect(names.placeholder).toBe('Mario, Peach')
    commit(names, ' Mario,  Luigi , ')
    commit(field(view.container, 'Member names'), '')
    expect(updates).toEqual([
      {
        orchestratorGameProjects: { repo1: { orchestrator: { memberNames: ['Mario', 'Luigi'] } } }
      },
      { orchestratorGameProjects: {} }
    ])
    view.unmount()
  })

  it("says members take the scene's names when no layer sets them, and refuses a ticket-like name", () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({}, undefined, updates)

    expect(view.container.textContent).toContain("The scene's names")
    commit(field(view.container, 'Member names'), 'Mario, K-9')
    expect(updates).toEqual([])
    expect(
      Array.from(view.container.querySelectorAll('[role="alert"]')).map((one) => one.textContent)
    ).toEqual([
      'Use 1 to 24 names separated by commas, each up to 32 characters and none like a ticket id.'
    ])
    view.unmount()
  })

  it('refuses a value the lead would drop and says why', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({}, undefined, updates)

    commit(field(view.container, 'Member cap'), '400')
    commit(field(view.container, 'Agent'), 'Not An Agent')
    expect(updates).toEqual([])
    const alerts = Array.from(view.container.querySelectorAll('[role="alert"]')).map(
      (alert) => alert.textContent
    )
    expect(alerts).toEqual([
      'Enter a whole number from 1 to 100.',
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
