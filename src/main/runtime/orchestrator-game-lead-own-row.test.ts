import { describe, expect, it } from 'vitest'
import { withCallerOwnRow } from './orchestrator-game-lead-own-row'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null
const row = (paneKey: string, parentPaneKey: string | null = null) => ({
  paneKey,
  parentPaneKey,
  state: 'working' as const,
  agentType: 'claude',
  displayName: null,
  taskTitle: null,
  toolName: null
})
const LEAD = row('tab-lead:1')
const MEMBER = row('tab-m:1', 'tab-lead:1')
// Why (ORCA-1402): the lead's row sits under the worktree of the tab holding its pane, which can
// differ from the worktree it calls game.state with, and the state then had no leader.
const SUMMARIES = [
  { worktreeId: 'wt-call', agents: [MEMBER] },
  { worktreeId: 'wt-tab', agents: [LEAD] }
]

describe('withCallerOwnRow', () => {
  it("adds the caller's own row when this host reports it under another worktree", () => {
    expect(withCallerOwnRow([MEMBER], SUMMARIES, 'tab-lead:1')).toEqual([MEMBER, LEAD])
  })

  it('keeps the rows as they are when they hold it, or no pane called', () => {
    const own = [LEAD, MEMBER]
    expect(withCallerOwnRow(own, SUMMARIES, 'tab-lead:1')).toBe(own)
    expect(withCallerOwnRow([MEMBER], SUMMARIES, null)).toEqual([MEMBER])
    expect(withCallerOwnRow([MEMBER], [SUMMARIES[0]!], 'tab-lead:1')).toEqual([MEMBER])
  })

  it('gives game.state a leader with its real state, so the Team panel draws the team', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: withCallerOwnRow([MEMBER], SUMMARIES, 'tab-lead:1'),
      leaderPaneKey: 'tab-lead:1',
      leaderUnreported: false,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents.find((one) => one.isLeader)).toMatchObject({
      paneKey: 'tab-lead:1',
      state: 'working'
    })
  })
})
