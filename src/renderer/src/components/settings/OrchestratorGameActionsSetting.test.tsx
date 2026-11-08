// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { ProjectOrchestratorGameActionsSetting } from './OrchestratorGameActionsSetting'
import { requestNewGameAction } from './game-actions-settings-intent'

vi.mock('../team-panel/use-team-lead-prompt', () => ({ useTeamLeadPrompt: () => null }))

type GameSettings = Pick<GlobalSettings, 'orchestratorGameProjects'>

const YAML: OrchestratorGameLayer = {
  actions: [
    { label: 'Release', command: 'release', icon: 'tag', pin: true, prompt: 'Prepare it' },
    { label: 'Board', command: 'board', mcp: { server: 'plane', tool: 'list' } }
  ]
}

function render(settings: GameSettings, projectLayer: OrchestratorGameLayer | undefined = YAML) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const updates: Partial<GlobalSettings>[] = []
  const draw = (next: GameSettings): void =>
    act(() => {
      root.render(
        <ProjectOrchestratorGameActionsSetting
          repoId="repo1"
          settings={next}
          projectLayer={projectLayer}
          updateSettings={(update) => {
            updates.push(update)
            draw({ ...next, ...update })
          }}
        />
      )
    })
  draw(settings)
  return { container, updates }
}

const press = (container: HTMLElement, name: string): void => {
  const target = [...container.querySelectorAll<HTMLElement>('button')].find(
    (one) => one.textContent?.trim() === name || one.getAttribute('aria-label') === name
  )
  expect(target, name).toBeTruthy()
  act(() => target!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string): void =>
  act(() => {
    const proto = Object.getPrototypeOf(input) as object
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-slot="game-action-row"]')].map((one) =>
    one.textContent?.replace(/\s+/g, ' ').trim()
  )
const actionsSaved = (updates: Partial<GlobalSettings>[]) =>
  updates.at(-1)?.orchestratorGameProjects?.repo1?.actions

describe('Settings > Actions, as V30', () => {
  it("lists the project's actions with their source and pin, then Orca's with when they apply", () => {
    const { container } = render({})
    expect(container.textContent).toContain('This project · 2 of 6')
    expect(rows(container)).toEqual([
      '↑Release/release · Ask the leadorca.yamlEdit',
      '↑Board/board · MCP planeorca.yamlEdit',
      'WaveWhen there is To Do and free slots.Edit',
      'PushWhen members are stopped.Edit',
      'SweepWhen finished members wait to be closed.Edit',
      'StatusAlways, in the menu.Edit',
      'StopAlways, with confirmation.Edit'
    ])
    const pins = container.querySelectorAll('[role="switch"][aria-label^="Show"]')
    expect([...pins].map((one) => one.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(container.querySelector('[aria-label="Turn on Stop"]')).toBeNull()
    expect(container.textContent).toContain('Start with')
  })

  it('creates an action first in the list, pinned, with the command from its name', () => {
    const { container, updates } = render({})
    press(container, 'Tests')
    const form = () => container.querySelector('[data-slot="game-action-form"]')!
    expect(form().querySelector<HTMLInputElement>('input')?.value).toBe('Tests')
    expect(form().textContent).toContain('/tests')
    press(container, 'Cancel')
    press(container, 'New action')
    type(form().querySelector<HTMLInputElement>('input')!, 'Smoke tests')
    expect(form().textContent).toContain('/smoke-tests')
    press(container, 'Icon flask')
    type(form().querySelector<HTMLTextAreaElement>('textarea')!, 'Run the smoke suite.')
    press(container, 'Create action')
    expect(
      actionsSaved(updates)?.map((one) => [one.label, one.command, one.icon, one.pin])
    ).toEqual([
      ['Smoke tests', 'smoke-tests', 'flask', true],
      ['Release', 'release', 'tag', true],
      ['Board', 'board', undefined, undefined]
    ])
    expect(rows(container)[0]).toContain('This machine')
  })

  it('starts a new action on the upload icon, selected and in the preview, as V30', () => {
    const { container, updates } = render({})
    press(container, 'New action')
    const form = container.querySelector('[data-slot="game-action-form"]')!
    const ship = form.querySelector('[aria-label="Icon ship"]')!
    expect(ship.getAttribute('aria-checked')).toBe('true')
    expect(
      form.querySelectorAll('[aria-label="Icon"] [role="radio"][aria-checked="true"]')
    ).toHaveLength(1)
    expect(form.querySelector('svg')?.innerHTML).toBe(ship.querySelector('svg')?.innerHTML)
    type(form.querySelector<HTMLInputElement>('input')!, 'Smoke')
    type(form.querySelector<HTMLTextAreaElement>('textarea')!, 'Run it.')
    press(container, 'Create action')
    expect(actionsSaved(updates)?.[0]?.icon).toBe('ship')
  })

  it("says what is wrong before saving, and holds the row's pins to three", () => {
    const { container, updates } = render({})
    press(container, 'New action')
    press(container, 'Create action')
    expect(container.textContent).toContain('Give the button a name.')
    const name = container.querySelector<HTMLInputElement>('[data-slot="game-action-form"] input')!
    type(name, 'Release')
    press(container, 'Create action')
    expect(container.textContent).toContain('/release already exists.')
    expect(updates).toEqual([])

    const three = render({
      orchestratorGameProjects: {
        repo1: {
          actions: ['A', 'B', 'C', 'D'].map((label, at) => ({
            label,
            prompt: label,
            pin: at < 3
          }))
        }
      }
    })
    press(three.container, 'Show D in the row')
    expect(three.container.textContent).toContain(
      'The row holds 3 of your actions. Turn another off first.'
    )
    press(three.container, 'Move D up')
    expect(actionsSaved(three.updates)?.map((one) => one.label)).toEqual(['A', 'B', 'D', 'C'])
  })

  it("turns Orca's off and edits their words on this machine; Stop has no switch", () => {
    const { container, updates } = render({})
    press(container, 'Turn on Wave')
    expect(updates.at(-1)?.orchestratorGameProjects?.repo1?.orcaActions).toEqual({
      wave: { enabled: false }
    })
    const editButtons = [...container.querySelectorAll<HTMLElement>('button')].filter(
      (one) => one.textContent === 'Edit'
    )
    act(() => editButtons[4]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const prompt = container.querySelector<HTMLTextAreaElement>(
      '[data-slot="game-action-form"] textarea'
    )!
    type(prompt, 'Close only with CI green.')
    press(container, 'Save')
    expect(updates.at(-1)?.orchestratorGameProjects?.repo1?.orcaActions).toEqual({
      wave: { enabled: false },
      sweep: { prompt: 'Close only with CI green.' }
    })
  })

  it("opens the new action form when the dock's menu asked for one, once", () => {
    requestNewGameAction('repo1')
    const { container } = render({})
    expect(container.querySelector('[data-slot="game-action-form"]')).not.toBeNull()
    const again = render({})
    expect(again.container.querySelector('[data-slot="game-action-form"]')).toBeNull()
  })
})
