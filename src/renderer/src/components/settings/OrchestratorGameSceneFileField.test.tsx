// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { sceneFile } from '../../../../shared/__fixtures__/orchestrator-game-scene'
import { useAppStore } from '../../store'
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
  SelectSeparator: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  )
}))

const REPO = { id: 'repo1', path: '/repo', connectionId: null }
const VALID = JSON.stringify(sceneFile())

type Files = Record<string, string>
let files: Files
let picked: string | null
const writes: string[] = []

function installApi(): void {
  const api = {
    fs: {
      readFile: vi.fn(async ({ filePath }: { filePath: string }) => {
        const content = files[filePath]
        if (content === undefined) {
          throw new Error(`ENOENT: no such file, open '${filePath}'`)
        }
        return { content, isBinary: false }
      }),
      pathExists: vi.fn(async ({ filePath }: { filePath: string }) => filePath in files),
      createFile: vi.fn(async ({ filePath }: { filePath: string }) => {
        if (filePath in files) {
          throw new Error('exists')
        }
        files[filePath] = ''
      }),
      writeFile: vi.fn(async ({ filePath, content }: { filePath: string; content: string }) => {
        writes.push(filePath)
        files[filePath] = content
      })
    },
    shell: { pickJsonFile: vi.fn(async () => picked) }
  }
  Object.assign(window, { api: api as unknown as Window['api'] })
}

const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

function render(node: React.ReactNode): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

function project(
  local: OrchestratorGameLayer | undefined,
  updates: Partial<GlobalSettings>[],
  projectLayer?: OrchestratorGameLayer
): React.JSX.Element {
  return (
    <ProjectOrchestratorGameSetting
      repo={REPO}
      settings={{ orchestratorGameProjects: local ? { repo1: local } : {} }}
      projectLayer={projectLayer}
      updateSettings={(update) => updates.push(update)}
    />
  )
}

const select = (container: HTMLElement): HTMLSelectElement =>
  Array.from(container.querySelectorAll('select')).find((one) =>
    Array.from(one.options).some((option) => option.value === 'quest')
  ) as HTMLSelectElement

function choose(container: HTMLElement, value: string): void {
  act(() => {
    select(container).value = value
    select(container).dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (entry) => entry.textContent?.trim() === label
  )
  expect(found, label).toBeTruthy()
  return found as HTMLButtonElement
}

const pathInput = (container: HTMLElement): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>('input[aria-label="Scene file"]')

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

const preview = (container: HTMLElement): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-slot="game-scene-preview"]')

beforeEach(() => {
  files = {}
  picked = null
  writes.length = 0
  installApi()
  usePluginPanelsStore.setState({ plugins: [], fetchStatus: 'ready' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('project scene file', () => {
  it('offers Custom file… only in the project picker', () => {
    const global = render(
      <OrchestratorGameSetting settings={{}} updateSettings={() => undefined} />
    )
    expect(global.container.textContent).not.toContain('Custom file…')
    global.unmount()

    const view = render(project(undefined, []))
    const options = Array.from(select(view.container).options).map((one) => one.textContent)
    expect(options).toContain('Custom file…')
    expect(pathInput(view.container)).toBeNull()
    view.unmount()
  })

  it('stores a typed path for this machine, clearing the scene, and refuses one leaving the project', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(project({ scene: 'jrpg', hud: false }, updates))
    choose(view.container, 'custom-file')
    const input = pathInput(view.container)
    expect(input).toBeTruthy()

    type(input as HTMLInputElement, '../outside.json')
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    expect(view.container.textContent).toContain('The path must stay inside the project (no ..).')
    expect(updates).toEqual([])

    type(input as HTMLInputElement, './.orca/scenes/space.json')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { hud: false, sceneFile: '.orca/scenes/space.json' } } }
    ])
    view.unmount()
  })

  it('previews a valid file from the project root and shows why an invalid one is not drawn', async () => {
    files['/repo/.orca/scenes/space.json'] = VALID
    const view = render(project({ sceneFile: '.orca/scenes/space.json' }, []))
    await settle()

    expect(select(view.container).value).toBe('custom-file')
    expect(pathInput(view.container)?.value).toBe('.orca/scenes/space.json')
    expect(preview(view.container)?.dataset.scene).toBe('file:.orca/scenes/space.json')
    expect(view.container.textContent).toContain('.orca/scenes/space.json · this machine')
    view.unmount()

    files['/repo/.orca/scenes/space.json'] = JSON.stringify(sceneFile({ band: 1 }))
    const broken = render(project({ sceneFile: '.orca/scenes/space.json' }, []))
    await settle()
    expect(broken.container.querySelector('[role="alert"]')?.textContent).toContain(
      "This file can't be drawn, so the game draws Quest: band: "
    )
    expect(preview(broken.container)?.dataset.scene).toBe('quest')
    broken.unmount()
  })

  it("previews and explains orca.yaml's scene file while this machine inherits it", async () => {
    const view = render(project(undefined, [], { sceneFile: 'scenes/gone.json' }))
    await settle()

    expect(select(view.container).value).toBe('inherit')
    expect(pathInput(view.container)).toBeNull()
    expect(view.container.textContent).toContain('scenes/gone.json · from orca.yaml')
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't read this file, so the game draws Quest"
    )
    view.unmount()
  })

  it('goes back to one built-in scene when one is picked', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(project({ sceneFile: 'a.json', rewards: false }, updates))
    choose(view.container, 'tamer')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { rewards: false, scene: 'tamer' } } }
    ])
    view.unmount()
  })

  it('creates a copy of the current built-in scene next to any existing one and uses it', async () => {
    files['/repo/.orca/scenes/vigilante.json'] = 'mine'
    const updates: Partial<GlobalSettings>[] = []
    const view = render(project({ scene: 'vigilante' }, updates))
    choose(view.container, 'custom-file')

    await act(async () => {
      button(view.container, 'Create from Night Watch (built-in)').click()
    })
    await settle()

    expect(writes).toEqual(['/repo/.orca/scenes/vigilante-2.json'])
    expect(files['/repo/.orca/scenes/vigilante.json']).toBe('mine')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { sceneFile: '.orca/scenes/vigilante-2.json' } } }
    ])
    view.unmount()
  })

  it('takes a picked file inside the project and refuses one outside it', async () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(project(undefined, updates))
    choose(view.container, 'custom-file')

    picked = '/elsewhere/space.json'
    await act(async () => {
      button(view.container, 'Choose file…').click()
    })
    expect(window.api.shell.pickJsonFile).toHaveBeenCalledWith({ defaultPath: '/repo' })
    expect(view.container.textContent).toContain('Pick a file inside this project (/repo).')
    expect(updates).toEqual([])

    picked = '/repo/scenes/space.json'
    await act(async () => {
      button(view.container, 'Choose file…').click()
    })
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { sceneFile: 'scenes/space.json' } } }
    ])
    view.unmount()
  })

  it("opens the file in Orca's editor in the project's worktree", () => {
    const openFile = vi.fn()
    const setActiveView = vi.fn()
    useAppStore.setState({
      openFile,
      setActiveView,
      setActiveWorktree: vi.fn(),
      ensureWorktreeRootGroup: () => 'group-1',
      activeWorktreeId: null,
      worktreesByRepo: {}
    })
    const view = render(project({ sceneFile: '.orca/scenes/space.json' }, []))

    act(() => button(view.container, 'Open in editor').click())
    expect(openFile).toHaveBeenCalledWith(
      {
        filePath: '/repo/.orca/scenes/space.json',
        relativePath: '.orca/scenes/space.json',
        worktreeId: 'repo1::/repo',
        language: 'json',
        mode: 'edit'
      },
      { targetGroupId: 'group-1' }
    )
    expect(setActiveView).toHaveBeenCalledWith('terminal')
    view.unmount()
  })

  it('hides the local file picker for an SSH project', () => {
    const view = render(
      <ProjectOrchestratorGameSetting
        repo={{ ...REPO, connectionId: 'ssh-1' }}
        settings={{ orchestratorGameProjects: { repo1: { sceneFile: 'a.json' } } }}
        projectLayer={undefined}
        updateSettings={() => undefined}
      />
    )
    expect(view.container.textContent).not.toContain('Choose file…')
    expect(view.container.textContent).toContain('Open in editor')
    view.unmount()
  })
})
