import { describe, expect, it } from 'vitest'
import type { GameAgentRow } from './orchestrator-game-fleet'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

const LEADER: GameAgentRow = {
  paneKey: 'tab-1:0',
  displayName: 'main',
  agentType: 'claude',
  state: 'working',
  taskTitle: null,
  toolName: null
}

const stateWith = (extra: {
  appearance?: 'dark' | 'light'
  label?: string
  uiLanguage?: 'en' | 'es'
}) =>
  buildOrchestratorGameState({
    settings: {
      uiLanguage: extra.uiLanguage ?? 'en',
      ...(extra.label ? { orchestratorGame: { orchestrator: { label: extra.label } } } : {})
    } as never,
    ...(extra.appearance ? { appearance: extra.appearance } : {}),
    worktree: {
      id: 'wt-1',
      repoId: null,
      path: '/w',
      branch: 'main',
      displayName: 'main',
      linkedWorkItem: null
    },
    agents: [LEADER],
    leaderPaneKey: LEADER.paneKey,
    readReview: none,
    readPlane: none,
    readLinear: none
  })

// Why: the mod draws the agent terminal's colours; it has no other way to know Orca's theme.
describe('the appearance the game state hands the mod', () => {
  it("sends Orca's resolved light or dark look", async () => {
    expect((await stateWith({ appearance: 'light' })).appearance).toBe('light')
    expect((await stateWith({ appearance: 'dark' })).appearance).toBe('dark')
  })

  it('sends none when the host cannot tell, so the mod keeps its default', async () => {
    expect((await stateWith({})).appearance).toBeUndefined()
  })
})

// Why: a heading must name the lead as its Team card does, not by its branch.
describe("the lead's name the game state hands the mod", () => {
  it("is the scene roster's last character when no Lead name is set", async () => {
    expect((await stateWith({})).leadName).toBe('Elaine')
  })

  it('is the Lead name when one is set', async () => {
    expect((await stateWith({ label: 'Boss' })).leadName).toBe('Boss')
  })
})
