// @vitest-environment happy-dom
// Why here: only this folder may import Settings, Orca's state builder and the mod together.

import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { buildOrchestratorGameState } from '../../../../src/main/runtime/orchestrator-game-state-builder'
import { ProjectOrchestratorGameViewRows } from '../../../../src/renderer/src/components/settings/OrchestratorGameViewSetting'
import type { GlobalSettings } from '../../../../src/shared/global-settings-types'
import { orchestratorGameViewSettingsOf } from '../../../../src/shared/orchestrator-game-view-settings'
import { DEFAULT_GAME_CONFIG, effectiveConfigOf } from '../hooks/game-config'
import { parseGameState } from '../hooks/game-state'
import { gameViewOf } from '../hooks/game-view'

vi.mock('../../../../src/renderer/src/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children
  }: {
    value: string
    onValueChange: (value: string) => void
    children: ReactNode
  }) =>
    createElement(
      'select',
      {
        value,
        onChange: (event: { currentTarget: { value: string } }) =>
          onValueChange(event.currentTarget.value)
      },
      children
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement('option', { value }, children)
}))

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>

const none = async () => null

/** What a game pane in repo r1 shows after its next `orca game state` poll. */
async function paneViewOf(settings: Partial<GameSettings>) {
  const state = await buildOrchestratorGameState({
    settings,
    worktree: {
      id: 'w1',
      repoId: 'r1',
      connectionId: null,
      path: '/nonexistent/orca-689-sync',
      branch: 'main',
      displayName: 'w',
      linkedWorkItem: null
    },
    agents: [],
    leaderPaneKey: null,
    readReview: none,
    readPlane: none,
    readLinear: none
  })
  const parsed = parseGameState(JSON.stringify(state))
  return gameViewOf(effectiveConfigOf(DEFAULT_GAME_CONFIG, parsed?.config ?? {}, undefined))
}

function settingsPage(
  settings: Partial<GameSettings>,
  onUpdate: (next: Partial<GameSettings>) => void
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(ProjectOrchestratorGameViewRows, {
        repoId: 'r1',
        settings,
        projectLayer: undefined,
        updateSettings: (update: Partial<GlobalSettings>) => onUpdate(update)
      })
    )
  })
  const select = container.querySelector('select') as HTMLSelectElement
  return {
    select,
    text: container.textContent ?? '',
    pick: (value: string) =>
      act(() => {
        select.value = value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }),
    close: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

describe('one view across Settings, Orca and the game pane', () => {
  it('a view picked in Settings reaches the pane, and one a pane stores reaches Settings', async () => {
    let settings: Partial<GameSettings> = {}

    // Settings → the pane's Panel and /orca-game:view, which both read the pane's resolved config.
    const page = settingsPage(settings, (update) => {
      settings = { ...settings, ...update }
    })
    page.pick('2d-hd')
    page.close()
    expect(await paneViewOf(settings)).toBe('2d-hd')

    // A pane's Panel or /orca-game:view runs `orca game view flat --scope project`; Orca writes this.
    settings = {
      ...settings,
      ...orchestratorGameViewSettingsOf(settings, { view: 'flat', scope: 'project', repoId: 'r1' })
    }
    const reopened = settingsPage(settings, () => undefined)
    expect(reopened.select.value).toBe('flat')
    expect(reopened.text).toContain('Flat · this machine')
    reopened.close()
    expect(await paneViewOf(settings)).toBe('flat')

    // Every project, from a pane: Settings' project row still shows its own layer winning.
    settings = {
      ...settings,
      ...orchestratorGameViewSettingsOf(settings, { view: 'zen', scope: 'global' })
    }
    expect(settings.orchestratorGame?.mode).toBe('zen')
    expect(await paneViewOf(settings)).toBe('flat')
  })
})
