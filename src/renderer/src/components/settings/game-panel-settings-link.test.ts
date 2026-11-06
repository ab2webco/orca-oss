import { describe, expect, it, vi } from 'vitest'
import { openGamePanelSettings } from './game-panel-settings-link'

const actionsOf = () => {
  const calls: string[] = []
  return {
    calls,
    openSettingsTarget: vi.fn(() => void calls.push('target')),
    openSettingsPage: vi.fn(() => void calls.push('page'))
  }
}

describe('openGamePanelSettings', () => {
  it("opens this project's game section with a team, target before page", () => {
    const actions = actionsOf()
    openGamePanelSettings(actions, 'repo-1')

    expect(actions.openSettingsTarget).toHaveBeenCalledWith({
      pane: 'repo',
      repoId: 'repo-1',
      sectionId: 'repo-repo-1-game'
    })
    expect(actions.calls).toEqual(['target', 'page'])
  })

  it('opens the global Panel section under Agents with no team', () => {
    const actions = actionsOf()
    openGamePanelSettings(actions, null)

    expect(actions.openSettingsTarget).toHaveBeenCalledWith({
      pane: 'agents',
      repoId: null,
      sectionId: 'agents-game-panel'
    })
    expect(actions.calls).toEqual(['target', 'page'])
  })
})
