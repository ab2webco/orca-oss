import { describe, expect, it } from 'vitest'
import { gamePanelTabHiddenSettingsOf } from './orchestrator-game-panel-tab-write'

describe('gamePanelTabHiddenSettingsOf', () => {
  it("hides the tab on the repo's own layer and keeps what else it holds", () => {
    const projects = { r1: { mode: 'flat' as const }, r2: { show: false } }

    expect(
      gamePanelTabHiddenSettingsOf({ orchestratorGameProjects: projects }, 'r1', 'prs')
    ).toEqual({
      orchestratorGameProjects: {
        r1: { mode: 'flat', panel: { tabs: { prs: false } } },
        r2: { show: false }
      }
    })
  })

  it('starts the layer for a repo that has none', () => {
    expect(gamePanelTabHiddenSettingsOf({}, 'r1', 'prs')).toEqual({
      orchestratorGameProjects: { r1: { panel: { tabs: { prs: false } } } }
    })
  })

  it('keeps a choice the layer already holds, since Settings is newer than the old layout', () => {
    const projects = { r1: { panel: { tabs: { prs: true } } } }

    expect(
      gamePanelTabHiddenSettingsOf({ orchestratorGameProjects: projects }, 'r1', 'prs')
    ).toBeNull()
  })
})
