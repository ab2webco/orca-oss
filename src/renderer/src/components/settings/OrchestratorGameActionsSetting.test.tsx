// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { ProjectOrchestratorGameActionsSetting } from './OrchestratorGameActionsSetting'
import { requestNewGameAction } from './game-actions-settings-intent'

vi.mock('../team-panel/use-team-lead-prompt', () => ({ useTeamLeadPrompt: () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

type GameSettings = Pick<GlobalSettings, 'orchestratorGameProjects'>

const release = {
  label: 'Release',
  command: 'release',
  icon: 'tag',
  pin: true,
  prompt: 'Prepare it'
}
const board = { label: 'Board', command: 'board', mcp: { server: 'plane', tool: 'list' } }
const YAML: OrchestratorGameLayer = { actions: [release as never, board] }
const YAML_TEXT = [
  '# Team buttons',
  'orchestratorGame:',
  '  actions:',
  '    - label: Release',
  '      command: release',
  '      icon: tag',
  '      pin: true',
  '      prompt: Prepare it',
  '    - label: Board',
  '      command: board',
  '      mcp: { server: plane, tool: list }',
  ''
].join('\n')

let files: Record<string, string>
const fs = {
  readFile: vi.fn(async ({ filePath }: { filePath: string }) => {
    if (!(filePath in files)) {
      throw new Error('ENOENT')
    }
    return { content: files[filePath]!, isBinary: false }
  }),
  pathExists: vi.fn(async ({ filePath }: { filePath: string }) => filePath in files),
  createFile: vi.fn(async () => {}),
  writeFile: vi.fn(async ({ filePath, content }: { filePath: string; content: string }) => {
    files[filePath] = content
  })
}

beforeEach(() => {
  files = { '/repo/orca.yaml': YAML_TEXT }
  fs.writeFile.mockClear()
  Object.assign(window, { api: { fs } })
})

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

async function render(settings: GameSettings) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const updates: Partial<GlobalSettings>[] = []
  const draw = (next: GameSettings): void =>
    act(() => {
      root.render(
        <ProjectOrchestratorGameActionsSetting
          repoId="repo1"
          rootPath="/repo"
          connectionId={undefined}
          isReachable
          settings={next}
          projectLayer={YAML}
          updateSettings={(update) => {
            updates.push(update)
            draw({ ...next, ...update })
          }}
        />
      )
    })
  draw(settings)
  await flush()
  return { container, updates }
}

const press = async (container: HTMLElement, name: string): Promise<void> => {
  const target = [...container.querySelectorAll<HTMLElement>('button')].find(
    (one) => one.textContent?.trim() === name || one.getAttribute('aria-label') === name
  )
  expect(target, name).toBeTruthy()
  act(() => target!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await flush()
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
const machineSaved = (updates: Partial<GlobalSettings>[]) =>
  updates.at(-1)?.orchestratorGameProjects?.repo1
const form = (container: HTMLElement) => container.querySelector('[data-slot="game-action-form"]')!

describe('Settings > Actions, as V30', () => {
  it("lists the project's actions with their source and pin, then Orca's with when they apply", async () => {
    const { container } = await render({})
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

  it('creates an action in orca.yaml by default, first and pinned, keeping the file as it was', async () => {
    const { container, updates } = await render({})
    await press(container, 'Tests')
    expect(form(container).querySelector<HTMLInputElement>('input')?.value).toBe('Tests')
    expect(form(container).textContent).toContain('/tests')
    await press(container, 'Cancel')
    await press(container, 'New action')
    expect(
      form(container).querySelector('[aria-label="Where it is saved"] [aria-checked="true"]')
        ?.textContent
    ).toBe('Project, orca.yaml')
    type(form(container).querySelector<HTMLInputElement>('input')!, 'Smoke tests')
    expect(form(container).textContent).toContain('/smoke-tests')
    await press(container, 'Icon flask')
    type(form(container).querySelector<HTMLTextAreaElement>('textarea')!, 'Run the smoke suite.')
    await press(container, 'Create action')
    const written = files['/repo/orca.yaml']!
    expect(
      written.startsWith('# Team buttons\norchestratorGame:\n  actions:\n    - label: Smoke tests')
    ).toBe(true)
    expect(written).toContain('prompt: Run the smoke suite.\n      icon: flask\n      pin: true')
    expect(written).toContain('mcp: { server: plane, tool: list }')
    expect(updates).toEqual([])
    expect(rows(container)[0]).toContain('Smoke tests')
    expect(rows(container)[0]).toContain('orca.yaml')
  })

  it('starts a new action on the upload icon, selected and in the preview, as V30', async () => {
    const { container } = await render({})
    await press(container, 'New action')
    const ship = form(container).querySelector('[aria-label="Icon ship"]')!
    expect(ship.getAttribute('aria-checked')).toBe('true')
    expect(
      form(container).querySelectorAll('[aria-label="Icon"] [role="radio"][aria-checked="true"]')
    ).toHaveLength(1)
    expect(form(container).querySelector('svg')?.innerHTML).toBe(
      ship.querySelector('svg')?.innerHTML
    )
    type(form(container).querySelector<HTMLInputElement>('input')!, 'Smoke')
    type(form(container).querySelector<HTMLTextAreaElement>('textarea')!, 'Run it.')
    await press(container, 'Create action')
    expect(files['/repo/orca.yaml']).toContain(
      '- label: Smoke\n      command: smoke\n      prompt: Run it.\n      icon: ship'
    )
  })

  it('saves an edit on this machine when its switch says so, and leaves orca.yaml alone', async () => {
    const { container, updates } = await render({})
    const edits = [...container.querySelectorAll<HTMLElement>('button')].filter(
      (one) => one.textContent === 'Edit'
    )
    act(() => edits[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await press(container, 'Only this machine')
    type(form(container).querySelector<HTMLInputElement>('input')!, 'Plane board')
    await press(container, 'Save')
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(machineSaved(updates)).toEqual({ machineActions: [{ ...board, label: 'Plane board' }] })
    expect(rows(container)[1]).toBe('↑Plane board/board · MCP planeThis machineEdit')
  })

  it('removes an orca.yaml action on this machine only by hiding its command here', async () => {
    const { container, updates } = await render({})
    const edits = [...container.querySelectorAll<HTMLElement>('button')].filter(
      (one) => one.textContent === 'Edit'
    )
    act(() => edits[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await press(container, 'Only this machine')
    await press(container, 'Remove')
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(machineSaved(updates)).toEqual({
      machineActions: [{ command: 'board', enabled: false }]
    })
    expect(container.textContent).toContain('This project · 1 of 6')
  })

  it("keeps a hidden orca.yaml action listed, dimmed, and 'Show' brings back that one alone", async () => {
    const { container, updates } = await render({
      orchestratorGameProjects: {
        repo1: { machineActions: [{ command: 'board', enabled: false }] }
      }
    })
    expect(rows(container).slice(0, 2)).toEqual([
      '↑Release/release · Ask the leadorca.yamlEdit',
      'Board/board · Hidden on this machineorca.yamlShow'
    ])
    const pin = container.querySelector('[role="switch"][aria-label="Show Board in the row"]')!
    expect(pin.hasAttribute('disabled')).toBe(true)
    expect(container.textContent).toContain('This project · 1 of 6')
    await press(container, 'Show')
    expect(updates).toHaveLength(1)
    expect(machineSaved(updates)?.machineActions).toBeUndefined()
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(rows(container).slice(0, 2)).toEqual([
      '↑Release/release · Ask the leadorca.yamlEdit',
      '↑Board/board · MCP planeorca.yamlEdit'
    ])
  })

  it("refuses a new action on a hidden action's command, so orca.yaml never holds it twice", async () => {
    const { container } = await render({
      orchestratorGameProjects: {
        repo1: { machineActions: [{ command: 'board', enabled: false }] }
      }
    })
    await press(container, 'New action')
    type(form(container).querySelector<HTMLInputElement>('input')!, 'Board')
    type(form(container).querySelector<HTMLTextAreaElement>('textarea')!, 'Read it.')
    await press(container, 'Create action')
    expect(container.textContent).toContain('/board already exists.')
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('turns an old full copy of orca.yaml into the one row flipped, on the first save', async () => {
    const { container, updates } = await render({
      orchestratorGameProjects: { repo1: { actions: [release as never, board] } }
    })
    expect(
      rows(container)
        .slice(0, 2)
        .map((one) => one?.includes('This machine'))
    ).toEqual([true, true])
    await press(container, 'Show Board in the row')
    expect(machineSaved(updates)).toEqual({ machineActions: [{ ...board, pin: true }] })
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it("says what is wrong before saving, and holds the row's pins to three", async () => {
    const { container, updates } = await render({})
    await press(container, 'New action')
    await press(container, 'Create action')
    expect(container.textContent).toContain('Give the button a name.')
    type(form(container).querySelector<HTMLInputElement>('input')!, 'Release')
    await press(container, 'Create action')
    expect(container.textContent).toContain('/release already exists.')
    expect(updates).toEqual([])
    expect(fs.writeFile).not.toHaveBeenCalled()

    const mine = ['A', 'B', 'C', 'D'].map((label, at) => ({
      label,
      command: label.toLowerCase(),
      prompt: label,
      pin: at < 2
    }))
    const three = await render({ orchestratorGameProjects: { repo1: { machineActions: mine } } })
    await press(three.container, 'Show D in the row')
    expect(three.container.textContent).toContain(
      'The row holds 3 of your actions. Turn another off first.'
    )
    await press(three.container, 'Move D up')
    expect(
      machineSaved(three.updates)?.machineActions?.map((one) => ('label' in one ? one.label : ''))
    ).toEqual(['A', 'B', 'D', 'C'])
  })

  it("turns Orca's off and edits their words on this machine; Stop has no switch", async () => {
    const { container, updates } = await render({})
    await press(container, 'Turn on Wave')
    expect(updates.at(-1)?.orchestratorGameProjects?.repo1?.orcaActions).toEqual({
      wave: { enabled: false }
    })
    const editButtons = [...container.querySelectorAll<HTMLElement>('button')].filter(
      (one) => one.textContent === 'Edit'
    )
    act(() => editButtons[4]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(form(container).textContent).not.toContain('Only this machine')
    const prompt = form(container).querySelector<HTMLTextAreaElement>('textarea')!
    type(prompt, 'Close only with CI green.')
    await press(container, 'Save')
    expect(updates.at(-1)?.orchestratorGameProjects?.repo1?.orcaActions).toEqual({
      wave: { enabled: false },
      sweep: { prompt: 'Close only with CI green.' }
    })
  })

  it("opens the new action form when the dock's menu asked for one, once", async () => {
    requestNewGameAction('repo1')
    const { container } = await render({})
    expect(container.querySelector('[data-slot="game-action-form"]')).not.toBeNull()
    const again = await render({})
    expect(again.container.querySelector('[data-slot="game-action-form"]')).toBeNull()
  })
})
