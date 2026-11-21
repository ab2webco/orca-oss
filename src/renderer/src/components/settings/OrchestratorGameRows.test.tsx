// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { useAppStore } from '../../store'
import { usePluginPanelsStore } from '../../store/plugin-panels'
import { OrchestratorGameSetting, ProjectOrchestratorGameSetting } from './OrchestratorGameSetting'
import { GamePanelSetting } from './OrchestratorGamePanelSetting'
import { GAME_ROWS, gameRowFactsOf } from './orchestrator-game-row-visibility'
import {
  getAgentTeamsGameSearchEntry,
  getGamePanelSearchEntries
} from './orchestrator-game-panel-search'
import { getAgentsPaneSearchEntries } from './agents-search'

// Why never settles: the panel preview's art loads from assets happy-dom cannot decode.
vi.mock('../team-scene/team-scene-art-load', () => ({
  loadTeamSceneArt: vi.fn(() => new Promise(() => {}))
}))

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

beforeEach(() => {
  usePluginPanelsStore.setState({ plugins: [], fetchStatus: 'ready' })
  Object.assign(window, {
    api: {
      fs: {
        readDir: async () => [],
        readFile: async () => {
          throw new Error('ENOENT')
        }
      }
    }
  })
})

afterEach(() => {
  useAppStore.setState({ settingsSearchQuery: '' })
})

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

const EVERYTHING: OrchestratorGameLayer = {
  mode: 'on',
  render: 'hd',
  band: true,
  panel: { look: 'game', style: 'figures' }
}

const globalPage = (layer: OrchestratorGameLayer) => (
  <>
    <GamePanelSetting settings={{ orchestratorGame: layer }} updateSettings={() => undefined} />
    <OrchestratorGameSetting
      settings={{ orchestratorGame: layer }}
      updateSettings={() => undefined}
    />
  </>
)

const projectPage = (layer: OrchestratorGameLayer | undefined) => (
  <ProjectOrchestratorGameSetting
    repo={{ id: 'repo1', path: '/repo', connectionId: null }}
    settings={{}}
    projectLayer={layer}
    updateSettings={() => undefined}
  />
)

const rowIds = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-game-row]')).map(
    (row) => row.dataset.gameRow ?? ''
  )
const groupIds = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-game-group]')).map(
    (group) => group.dataset.gameGroup ?? ''
  )

describe('the game rows follow one table (ORCA-1112)', () => {
  it('draws the project page in the table order when every row is in use', () => {
    const view = render(projectPage(EVERYTHING))

    expect(rowIds(view.container)).toEqual(GAME_ROWS.map((row) => row.id))
    expect(groupIds(view.container)).toEqual(['panel', 'terminal', 'band'])
    view.unmount()
  })

  it('draws the global page with Panel first, and no project-only rows', () => {
    const view = render(globalPage(EVERYTHING))

    expect(rowIds(view.container)).toEqual(
      GAME_ROWS.map((row) => row.id).filter((id) => id !== 'advisor' && id !== 'arcade')
    )
    view.unmount()
  })

  it('places Actions, Names and Lead after the panel rows and before the terminal panes', () => {
    const view = render(projectPage(EVERYTHING))
    const panel = view.container.querySelector('[data-game-group="panel"]')!
    const terminal = view.container.querySelector('[data-game-group="terminal"]')!
    const lead = Array.from(view.container.querySelectorAll('h3')).find(
      (heading) => heading.textContent === 'Lead'
    )!

    expect(panel.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lead.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    view.unmount()
  })

  it('hides the terminal band group and its heading when the view is not a pixel view', () => {
    for (const page of [globalPage({ mode: 'flat', band: true }), projectPage({ mode: 'flat' })]) {
      const view = render(page)

      expect(groupIds(view.container)).not.toContain('band')
      expect(view.container.textContent).not.toContain('Terminal band')
      expect(view.container.querySelector('[aria-label="Render"]')).toBeNull()
      view.unmount()
    }
  })

  it('shows the band group for each pixel view, and what it draws only with the band on', () => {
    for (const mode of ['zen', 'on'] as const) {
      const off = render(projectPage({ mode, band: false }))
      expect(rowIds(off.container)).toContain('band')
      expect(rowIds(off.container)).not.toContain('render')
      off.unmount()
      const on = render(projectPage({ mode, band: true }))
      expect(rowIds(on.container)).toEqual(
        expect.arrayContaining(['band', 'bandPreview', 'render'])
      )
      on.unmount()
    }
  })

  it('drops what only the Game look reads in Plain, keeping the stored values', () => {
    const updates: Partial<GlobalSettings>[] = []
    const view = render(
      <GamePanelSetting
        settings={{ orchestratorGame: { mode: 'flat', panel: { look: 'plain', style: 'office' } } }}
        updateSettings={(next) => updates.push(next)}
      />
    )

    expect(rowIds(view.container)).toEqual(['look', 'prs', 'machines'])
    expect(updates).toEqual([])
    view.unmount()
  })

  it('shows only the gate while the game is hidden', () => {
    const view = render(
      <OrchestratorGameSetting
        settings={{ orchestratorGame: { show: false } }}
        updateSettings={() => undefined}
      />
    )

    expect(rowIds(view.container)).toEqual(['show'])
    view.unmount()
  })
})

describe('Settings search follows the shown rows (ORCA-1112)', () => {
  const flat = gameRowFactsOf({ page: 'global', layers: { global: { mode: 'flat' } } })
  const drawing = gameRowFactsOf({
    page: 'global',
    layers: { global: { mode: 'on', band: true } }
  })

  it('offers a band term only while the band group shows', () => {
    expect(getAgentTeamsGameSearchEntry(flat).keywords).not.toContain('Render')
    expect(getAgentTeamsGameSearchEntry(flat).keywords).not.toContain('Show the band')
    expect(getAgentTeamsGameSearchEntry(drawing).keywords).toEqual(
      expect.arrayContaining(['Render', 'Show the band'])
    )
  })

  it('offers a Game-look term only in the Game look', () => {
    const plain = gameRowFactsOf({
      page: 'global',
      layers: { global: { mode: 'flat', panel: { look: 'plain' } } }
    })
    expect(getGamePanelSearchEntries(plain)[0].keywords).not.toContain('Scene style')
    expect(getGamePanelSearchEntries(drawing)[0].keywords).toContain('Scene style')
  })

  it('leaves the Agents pane out of a band search while the view is Flat', () => {
    const terms = (facts: typeof flat) =>
      getAgentsPaneSearchEntries({ gameFacts: facts }).flatMap((entry) => entry.keywords ?? [])
    expect(terms(flat)).not.toContain('Render')
    expect(terms(drawing)).toContain('Render')
  })

  it('draws nothing for a band term searched while the view is Flat', () => {
    useAppStore.setState({ settingsSearchQuery: 'render' })
    const view = render(globalPage({ mode: 'flat' }))
    expect(view.container.textContent).toBe('')
    view.unmount()

    const shown = render(globalPage({ mode: 'on', band: true }))
    expect(shown.container.querySelector('[aria-label="Render"]')).toBeTruthy()
    shown.unmount()
  })
})
