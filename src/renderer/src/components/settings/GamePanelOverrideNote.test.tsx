// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import { GamePanelSetting } from './OrchestratorGamePanelSetting'

vi.mock('../team-scene/team-scene-art-load', () => ({
  loadTeamSceneArt: vi.fn(() => new Promise(() => {}))
}))

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>

// ORCA-1203: the owner's saved layers, with Display picked globally.
const owner: GameSettings = {
  orchestratorGame: { panel: { style: 'office', look: 'display' } },
  orchestratorGameProjects: {
    oss: { panel: { style: 'office', look: 'game' }, mode: 'on', band: true }
  }
}

function render(settings: GameSettings, updates: Partial<GlobalSettings>[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(<GamePanelSetting settings={settings} updateSettings={(u) => updates.push(u)} />)
  )
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

const note = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="game-panel-override"][data-field="look"]')

const button = (scope: HTMLElement | null, label: string) =>
  Array.from(scope?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
    (one) => one.textContent?.trim() === label
  )

describe('the global Panel look row when a project overrides it', () => {
  const openSettingsTarget = vi.fn()

  beforeEach(() => {
    useAppStore.setState({
      repos: [{ id: 'oss', displayName: 'orca-oss', path: '/r/oss' } as Repo],
      openSettingsTarget
    })
  })

  afterEach(() => {
    openSettingsTarget.mockReset()
    useAppStore.setState({ repos: [] })
  })

  it('names the project and its value on this machine, and resets it to the global one', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(owner, updates)

    const hint = note(view.container)
    expect(hint?.textContent).toContain('orca-oss uses Game on this machine')
    act(() => button(hint, 'Use global')?.click())
    expect(updates).toEqual([
      {
        orchestratorGameProjects: { oss: { panel: { style: 'office' }, mode: 'on', band: true } }
      }
    ])
    view.unmount()
  })

  it("opens the project's game section", () => {
    const view = render(owner, [])

    act(() => button(note(view.container), 'Open project')?.click())
    expect(openSettingsTarget).toHaveBeenCalledWith({
      pane: 'repo',
      repoId: 'oss',
      sectionId: 'repo-oss-game'
    })
    view.unmount()
  })

  it('names the host when two projects share a name', () => {
    useAppStore.setState({
      repos: [
        { id: 'oss', displayName: 'orca-oss', path: '/r/oss' } as Repo,
        {
          id: 'oss-m1',
          displayName: 'orca-oss',
          path: '/r/oss',
          connectionId: 'm1',
          executionHostId: 'ssh:m1'
        } as Repo
      ]
    })
    const layer = owner.orchestratorGameProjects!.oss
    const view = render({ ...owner, orchestratorGameProjects: { oss: layer, 'oss-m1': layer } }, [])

    expect(note(view.container)?.textContent).toContain('orca-oss · m1 uses Game on this machine')
    view.unmount()
  })

  it('says nothing when every project shows the global look', () => {
    const view = render({ ...owner, orchestratorGame: { panel: { look: 'game' } } }, [])

    expect(note(view.container)).toBeNull()
    view.unmount()
  })

  it('skips a saved layer for a project Orca no longer has', () => {
    const view = render(
      { ...owner, orchestratorGameProjects: { gone: { panel: { look: 'game' } } } },
      []
    )

    expect(note(view.container)).toBeNull()
    view.unmount()
  })
})
