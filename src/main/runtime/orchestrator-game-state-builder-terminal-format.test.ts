import { describe, expect, it } from 'vitest'
import type { GameAgentRow } from './orchestrator-game-fleet'
import { GameLeadNames } from './orchestrator-game-lead-names'
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
  leadNames?: GameLeadNames
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
    ...(extra.leadNames ? { leadNames: extra.leadNames } : {}),
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
  it("is the scene roster's last character when no Lead name is set", async () => {
    expect((await stateWith({})).leadName).toBe('Elaine')
  })

  it('is the Lead name when one is set', async () => {
    expect((await stateWith({ label: 'Boss' })).leadName).toBe('Boss')
  })
})

// ORCA-1139 criterion 5: the lead was Elaine, then Cipher, then Vigía nocturno as scene and language changed.
describe("the lead's name for the session", () => {
  it('keeps the first character it resolved when the scene and the language change', async () => {
    const leadNames = new GameLeadNames()
    const unkept = (await stateWith({ scene: 'vigilante', uiLanguage: 'es' })).leadName
    expect(unkept).not.toBe('Elaine')

    expect((await stateWith({ leadNames })).leadName).toBe('Elaine')
    expect((await stateWith({ leadNames, scene: 'vigilante' })).leadName).toBe('Elaine')
    expect((await stateWith({ leadNames, scene: 'vigilante', uiLanguage: 'es' })).leadName).toBe(
      'Elaine'
    )
  })

  it("gives the lead's members the same name, and another lead its own", async () => {
    const leadNames = new GameLeadNames()
    await stateWith({ leadNames })
    const member = await stateWith({
      leadNames,
      scene: 'vigilante',
      leaderPaneKey: 'tab-2:0',
      callerParentPaneKey: LEADER.paneKey
    })
    expect(member.leadName).toBe('Elaine')
    const other = await stateWith({ leadNames, scene: 'vigilante', leaderPaneKey: 'tab-3:0' })
    expect(other.leadName).not.toBe('Elaine')
  })

  it('lets a Lead name set later win over the kept character', async () => {
    const leadNames = new GameLeadNames()
    await stateWith({ leadNames })
    expect((await stateWith({ leadNames, label: 'Boss' })).leadName).toBe('Boss')
  })
})
