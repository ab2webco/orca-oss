// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import {
  ProjectOrchestratorGameNamesSetting,
  type OrchestratorGameNamesScene
} from './OrchestratorGameNamesSetting'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>

const QUEST: OrchestratorGameNamesScene = { id: 'quest', extensions: [] }

function render(
  settings: GameSettings,
  projectLayer: OrchestratorGameLayer | undefined,
  updates: Partial<GlobalSettings>[] = [],
  scene: OrchestratorGameNamesScene = QUEST
): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ProjectOrchestratorGameNamesSetting
        repoId="repo1"
        settings={settings}
        projectLayer={projectLayer}
        scene={scene}
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

// ORCA-1304: the owner found no place to set the names and nothing said where they come from.
describe('ProjectOrchestratorGameNamesSetting', () => {
  it("says the names come from the scene and lists the scene's roster in use", () => {
    const view = render({}, undefined)
    const text = view.container.textContent ?? ''

    expect(text).toContain('Names')
    expect(text).toContain("the scene's roster")
    expect(text).toContain('Arthur, Merlin, Lancelot')
    expect(text).toContain('from the scene')
    expect(text).toContain('Lead, until you name it · default')
    view.unmount()
  })

  it("lists a custom scene's own roster", () => {
    const scene: OrchestratorGameNamesScene = {
      id: 'file:scenes/kart.json',
      extensions: [{ id: 'file:scenes/kart.json', definition: { roster: ['Mario', 'Luigi'] } }]
    }
    const view = render({}, undefined, [], scene)

    expect(view.container.textContent).toContain('Mario, Luigi · from the scene')
    expect(field(view.container, 'Member names').placeholder).toBe('Mario, Luigi')
    view.unmount()
  })

  it('says the names come from the scene when Settings cannot read its roster', () => {
    const view = render({}, undefined, [], { id: 'acme:kart', extensions: [] })

    expect(view.container.textContent).toContain("The scene's names · from the scene")
    view.unmount()
  })

  it('names the lead on this machine with the layer it comes from, and inherits when cleared', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      { orchestratorGameProjects: { repo1: { orchestrator: { label: 'Boss' } } } },
      { orchestrator: { label: 'Chief' } },
      updates
    )

    expect(view.container.textContent).toContain('Boss · this machine')
    const lead = field(view.container, 'Lead name')
    expect(lead.value).toBe('Boss')
    expect(lead.placeholder).toBe('Chief')
    commit(lead, ' Alfred ')
    commit(field(view.container, 'Lead name'), '')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { orchestrator: { label: 'Alfred' } } } },
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
    expect(view.container.textContent).toContain('Ann · this machine')
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

  it('refuses a ticket-like member name and says why', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({}, undefined, updates)

    commit(field(view.container, 'Member names'), 'Mario, K-9')
    expect(updates).toEqual([])
    expect(
      Array.from(view.container.querySelectorAll('[role="alert"]')).map((one) => one.textContent)
    ).toEqual([
      'Use 1 to 24 names separated by commas, each up to 32 characters and none like a ticket id.'
    ])
    view.unmount()
  })
})
