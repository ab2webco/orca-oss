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
  SelectSeparator: () => null,
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

let sceneFiles: string[] = []

beforeEach(() => {
  usePluginPanelsStore.setState({ plugins: [spacePack], fetchStatus: 'ready' })
  sceneFiles = []
  // Why: the project picker lists `.orca/scenes`; each test names the files that folder holds.
  Object.assign(window, {
    api: {
      fs: {
        readDir: async () =>
          sceneFiles.map((name) => ({ name, isDirectory: false, isSymlink: false })),
        readFile: async () => {
          throw new Error('ENOENT')
        }
      }
    }
  })
})

function sceneSelect(container: HTMLElement): HTMLSelectElement {
  // Why by its options: the Default view select comes first in the section.
  const select = Array.from(container.querySelectorAll('select')).find((one) =>
    Array.from(one.options).some((option) => option.value === 'quest')
  )
  expect(select).toBeTruthy()
  return select as HTMLSelectElement
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const viewSelect = (container: HTMLElement): HTMLSelectElement =>
  Array.from(container.querySelectorAll('select')).find((one) =>
    Array.from(one.options).some((option) => option.value === '2d-hd')
  ) as HTMLSelectElement

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
  it('writes the global layer from the default view and the switches', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <OrchestratorGameSetting
        settings={{ orchestratorGame: { rewards: false } }}
        updateSettings={(update) => updates.push(update)}
      />
    )

    choose(viewSelect(view.container), 'zen')
    click(view.container, '[role="switch"]', 'Teammate HUD')
    expect(updates).toEqual([
      { orchestratorGame: { rewards: false, mode: 'zen' } },
      { orchestratorGame: { rewards: false, hud: false } }
    ])
    view.unmount()
  })
})

describe('game settings section', () => {
  it('titles the section and says it only applies to Claude Agent Teams panes', () => {
    const view = render(<OrchestratorGameSetting settings={{}} updateSettings={() => undefined} />)

    const heading = view.container.querySelector('h3')
    expect(heading?.textContent).toBe('Agent Teams game')
    expect(view.container.textContent).toContain('Applies only to Claude Agent Teams panes')
    view.unmount()
  })

  it('previews the effective scene and mode', () => {
    const view = render(
      <OrchestratorGameSetting
        settings={{ orchestratorGame: { scene: 'tamer', mode: 'zen' } }}
        updateSettings={() => undefined}
      />
    )
    const preview = view.container.querySelector<HTMLElement>('[data-slot="game-scene-preview"]')
    expect(preview?.dataset.scene).toBe('tamer')
    expect(preview?.dataset.mode).toBe('zen')
    view.unmount()
  })

  it('previews the project scene this machine resolves', () => {
    const view = render(
      <ProjectOrchestratorGameSetting
        repo={{ id: 'repo1', path: '/repo', connectionId: null }}
        settings={{ orchestratorGame: { scene: 'tamer' } }}
        projectLayer={{ scene: 'jrpg', mode: 'off' }}
        updateSettings={() => undefined}
      />
    )
    expect(view.container.querySelector('h3')?.textContent).toBe('Agent Teams game')
    expect(view.container.textContent).toContain('Applies only to Claude Agent Teams panes')
    const preview = view.container.querySelector<HTMLElement>('[data-slot="game-scene-preview"]')
    expect(preview?.dataset.scene).toBe('jrpg')
    expect(preview?.dataset.mode).toBe('off')
    view.unmount()
  })
})

describe('ProjectOrchestratorGameSetting', () => {
  it('shows where the effective value comes from and overrides it for this machine', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <ProjectOrchestratorGameSetting
        repo={{ id: 'repo1', path: '/repo', connectionId: null }}
        settings={{ orchestratorGameProjects: { repo1: { hud: false } } }}
        projectLayer={{ mode: 'off' }}
        updateSettings={(update) => updates.push(update)}
      />
    )

    expect(view.container.textContent).toContain('Off · from orca.yaml')
    expect(view.container.textContent).toContain('Off · this machine')

    choose(viewSelect(view.container), 'zen')
    click(view.container, '[aria-label="Teammate HUD"] button', 'Inherit')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { hud: false, mode: 'zen' } } },
      { orchestratorGameProjects: {} }
    ])
    view.unmount()
  })
})

describe('where game links open', () => {
  it('writes it globally and lets a project override or inherit what orca.yaml says', () => {
    const updates: Partial<GlobalSettings>[] = []
    const global = render(
      <OrchestratorGameSetting settings={{}} updateSettings={(update) => updates.push(update)} />
    )
    click(global.container, '[aria-label="Open links in"] button', 'System browser')
    global.unmount()

    const project = render(
      <ProjectOrchestratorGameSetting
        repo={{ id: 'repo1', path: '/repo', connectionId: null }}
        settings={{}}
        projectLayer={{ openLinks: 'system' }}
        updateSettings={(update) => updates.push(update)}
      />
    )
    expect(project.container.textContent).toContain('System browser · from orca.yaml')
    click(project.container, '[aria-label="Open links in"] button', 'Orca')
    expect(updates).toEqual([
      { orchestratorGame: { openLinks: 'system' } },
      { orchestratorGameProjects: { repo1: { openLinks: 'orca' } } }
    ])
    project.unmount()
  })
})

describe('game scene picker', () => {
  it('offers the built-in scenes and those of running plugins, and writes the pick globally', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <OrchestratorGameSetting settings={{}} updateSettings={(update) => updates.push(update)} />
    )

    const select = sceneSelect(view.container)
    expect(select.value).toBe('quest')
    expect(optionsOf(select)).toEqual([
      ['quest', 'Quest (built-in)'],
      ['vigilante', 'Night Watch (built-in)'],
      ['jrpg', 'Crystal Saga (built-in)'],
      ['tamer', 'Beast Tamer (built-in)'],
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
        repo={{ id: 'repo1', path: '/repo', connectionId: null }}
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

  it("lists the project's scene files as custom scenes and picks one for this machine", async () => {
    sceneFiles = ['deep-space.json']
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <ProjectOrchestratorGameSetting
        repo={{ id: 'repo1', path: '/repo', connectionId: null }}
        settings={{}}
        projectLayer={undefined}
        updateSettings={(update) => updates.push(update)}
      />
    )
    await act(async () => {
      await Promise.resolve()
    })

    const select = sceneSelect(view.container)
    expect(optionsOf(select)).toContainEqual([
      'file:.orca/scenes/deep-space.json',
      'deep-space (custom)'
    ])
    choose(select, 'file:.orca/scenes/deep-space.json')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { sceneFile: '.orca/scenes/deep-space.json' } } }
    ])
    view.unmount()
  })

  it('shows a listed scene file this machine picked as selected', async () => {
    sceneFiles = ['deep-space.json']
    const view = render(
      <ProjectOrchestratorGameSetting
        repo={{ id: 'repo1', path: '/repo', connectionId: null }}
        settings={{
          orchestratorGameProjects: { repo1: { sceneFile: '.orca/scenes/deep-space.json' } }
        }}
        projectLayer={undefined}
        updateSettings={() => undefined}
      />
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(sceneSelect(view.container).value).toBe('file:.orca/scenes/deep-space.json')
    view.unmount()
  })
})

function typeAndLeave(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

const timezoneField = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Time zone"]')
  expect(input).toBeTruthy()
  return input as HTMLInputElement
}

describe('render and time zone', () => {
  it('writes the render and a valid time zone globally, refusing a zone that does not exist', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <OrchestratorGameSetting settings={{}} updateSettings={(update) => updates.push(update)} />
    )
    click(view.container, '[aria-label="Render"] button', 'HD')
    typeAndLeave(timezoneField(view.container), 'Mars/Olympus')
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
      'Use local or an IANA time zone such as America/Bogota.'
    )
    typeAndLeave(timezoneField(view.container), ' America/Bogota ')
    expect(updates).toEqual([
      { orchestratorGame: { render: 'hd' } },
      { orchestratorGame: { timezone: 'America/Bogota' } }
    ])
    view.unmount()
  })

  it('offers hd-compact next to classic and hd', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <OrchestratorGameSetting settings={{}} updateSettings={(update) => updates.push(update)} />
    )
    click(view.container, '[aria-label="Render"] button', 'HD compact')
    expect(updates).toEqual([{ orchestratorGame: { render: 'hd-compact' } }])
    view.unmount()
  })

  it('goes back to the local clock when the global zone is cleared', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <OrchestratorGameSetting
        settings={{ orchestratorGame: { timezone: 'Asia/Tokyo' } }}
        updateSettings={(update) => updates.push(update)}
      />
    )
    expect(timezoneField(view.container).value).toBe('Asia/Tokyo')
    typeAndLeave(timezoneField(view.container), '')
    expect(updates).toEqual([{ orchestratorGame: {} }])
    view.unmount()
  })

  it('shows the project its effective render and zone with their source and overrides or inherits them', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <ProjectOrchestratorGameSetting
        repo={{ id: 'repo1', path: '/repo', connectionId: null }}
        settings={{ orchestratorGame: { timezone: 'America/Bogota' } }}
        projectLayer={{ render: 'hd' }}
        updateSettings={(update) => updates.push(update)}
      />
    )
    expect(view.container.textContent).toContain('HD · from orca.yaml')
    expect(view.container.textContent).toContain('America/Bogota · global setting')
    click(view.container, '[aria-label="Render"] button', 'Classic')
    typeAndLeave(timezoneField(view.container), 'Europe/Madrid')
    expect(updates).toEqual([
      { orchestratorGameProjects: { repo1: { render: 'classic' } } },
      { orchestratorGameProjects: { repo1: { timezone: 'Europe/Madrid' } } }
    ])
    view.unmount()
  })
})

describe('the preview follows the render', () => {
  it('previews hd globally and per project when the render resolves to hd', () => {
    const global = render(
      <OrchestratorGameSetting
        settings={{ orchestratorGame: { render: 'hd' } }}
        updateSettings={() => undefined}
      />
    )
    const preview = (container: HTMLElement) =>
      container.querySelector<HTMLElement>('[data-slot="game-scene-preview"]')
    expect(preview(global.container)?.dataset.render).toBe('hd')
    global.unmount()
    const project = render(
      <ProjectOrchestratorGameSetting
        repo={{ id: 'repo1', path: '/repo', connectionId: null }}
        settings={{ orchestratorGame: { render: 'hd' } }}
        projectLayer={{ render: 'classic' }}
        updateSettings={() => undefined}
      />
    )
    expect(preview(project.container)?.dataset.render).toBe('classic')
    project.unmount()
  })
})
