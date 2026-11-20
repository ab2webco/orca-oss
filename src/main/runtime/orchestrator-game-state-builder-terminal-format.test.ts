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
  scene?: string
  callerParentPaneKey?: string
  leaderPaneKey?: string
}) =>
  buildOrchestratorGameState({
    settings: {
      uiLanguage: extra.uiLanguage ?? 'en',
      orchestratorGame: {
        ...(extra.scene ? { scene: extra.scene } : {}),
        ...(extra.label ? { orchestrator: { label: extra.label } } : {})
      }
    } as never,
    ...(extra.appearance ? { appearance: extra.appearance } : {}),
    ...(extra.callerParentPaneKey ? { callerParentPaneKey: extra.callerParentPaneKey } : {}),
    worktree: {
      id: 'wt-1',
      repoId: null,
      path: '/w',
      branch: 'main',
      displayName: 'main',
      linkedWorkItem: null
    },
    agents: [LEADER],
    leaderPaneKey: extra.leaderPaneKey ?? LEADER.paneKey,
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
  // ORCA-1304: an unnamed lead is "Lead" whatever the scene or language, never a roster character.
  it('is the plain word when no Lead name is set', async () => {
    expect((await stateWith({})).leadName).toBe('Lead')
    expect((await stateWith({ scene: 'vigilante', uiLanguage: 'es' })).leadName).toBe('Lead')
  })

  it('is the Lead name when one is set', async () => {
    expect((await stateWith({ label: 'Boss' })).leadName).toBe('Boss')
  })

  // Why the parent pane: a member's state must name its lead as the lead's own does.
  it("gives a member's state its lead's name, set or not", async () => {
    const member = { leaderPaneKey: 'tab-2:0', callerParentPaneKey: LEADER.paneKey }
    expect((await stateWith({ ...member, scene: 'vigilante' })).leadName).toBe('Lead')
    expect((await stateWith({ ...member, label: 'Boss' })).leadName).toBe('Boss')
  })
})
