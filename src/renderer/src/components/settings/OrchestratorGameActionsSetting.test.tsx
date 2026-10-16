// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { ProjectOrchestratorGameActionsSetting } from './OrchestratorGameActionsSetting'

type GameSettings = Pick<GlobalSettings, 'orchestratorGameProjects'>

const YAML: OrchestratorGameLayer = {
  actions: [
    { label: 'Test runs', command: 'test-runs', prompt: 'Run the QA test runs' },
    { label: 'Runs', mcp: { server: 'tambora', tool: 'list_test_runs' } }
  ]
}

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
      <ProjectOrchestratorGameActionsSetting
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

function click(container: HTMLElement, label: string): void {
  const target = Array.from(container.querySelectorAll<HTMLElement>('button')).find(
    (entry) => entry.textContent?.trim() === label || entry.getAttribute('aria-label') === label
  )
  expect(target, label).toBeTruthy()
  act(() => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const button = (container: HTMLElement, label: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (entry) => entry.textContent?.trim() === label
  )

function type(container: HTMLElement, label: string, value: string): void {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`
  )
  expect(input, label).toBeTruthy()
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ProjectOrchestratorGameActionsSetting', () => {
  it('shows the orca.yaml list read only until it is edited on this machine', () => {
    const view = render({}, YAML)
    const text = view.container.textContent ?? ''
    expect(text).toContain('Test runs')
    expect(text).toContain('/test-runs')
    expect(text).toContain('tambora · list_test_runs')
    expect(view.container.querySelector('input')).toBeNull()

    click(view.container, 'Edit on this machine')
    expect(view.container.querySelector<HTMLInputElement>('[aria-label="Label 1"]')?.value).toBe(
      'Test runs'
    )
    expect(view.container.querySelector<HTMLInputElement>('[aria-label="Tool 2"]')?.value).toBe(
      'list_test_runs'
    )
    view.unmount()
  })

  it("saves this machine's list, which replaces orca.yaml's whole", () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render({}, YAML, updates)
    click(view.container, 'Edit on this machine')
    click(view.container, 'Remove action 2')
    click(view.container, 'Add action')
    type(view.container, 'Label 2', 'Wave QA')
    type(view.container, 'Command 2', 'wave-qa')
    type(view.container, 'Prompt 2', 'Launch a member for each QA ticket')
    click(view.container, 'Save actions')

    expect(updates).toEqual([
      {
        orchestratorGameProjects: {
          repo1: {
            actions: [
              { label: 'Test runs', command: 'test-runs', prompt: 'Run the QA test runs' },
              { label: 'Wave QA', command: 'wave-qa', prompt: 'Launch a member for each QA ticket' }
            ]
          }
        }
      }
    ])
    view.unmount()
  })

  it('says what is wrong in a row and keeps Save off until it is fixed', () => {
    const view = render({}, YAML)
    click(view.container, 'Edit on this machine')
    type(view.container, 'Command 1', 'wave')
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
      'A lead button or another action already uses this command.'
    )
    expect(button(view.container, 'Save actions')?.disabled).toBe(true)

    type(view.container, 'Command 1', 'Bad Name')
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
      'Use a lowercase name like test-runs, up to 24 characters.'
    )
    const kind = view.container.querySelector<HTMLElement>('[aria-label="Kind 1"]')
    expect(kind).toBeTruthy()
    click(kind as HTMLElement, 'MCP')
    type(view.container, 'Command 1', '')
    type(view.container, 'MCP server 1', 'tambora')
    type(view.container, 'Tool 1', 'list')
    type(view.container, 'Arguments (JSON) 1', '{nope')
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
      'Arguments must be a JSON object, like {"project": "CIN"}.'
    )
    view.unmount()
  })

  it('inherits orca.yaml again, and can save an empty list', () => {
    const updates: Partial<GlobalSettings>[] = []
    const local = { orchestratorGameProjects: { repo1: { actions: YAML.actions } } }
    const view = render(local, YAML, updates)
    click(view.container, 'Remove action 2')
    click(view.container, 'Remove action 1')
    expect(view.container.textContent).toContain('No actions on this machine.')
    click(view.container, 'Save actions')
    click(view.container, 'Inherit from orca.yaml')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { actions: [] } } },
      { orchestratorGameProjects: {} }
    ])
    expect(view.container.textContent).toContain('Edit on this machine')
    view.unmount()
  })
})
