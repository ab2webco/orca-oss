import { describe, expect, it } from 'vitest'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null
const MEMBER_ROW = {
  paneKey: 'tab-m:1',
  parentPaneKey: 'tab-lead:1',
  state: 'working' as const,
  agentType: 'claude',
  displayName: null,
  taskTitle: 'ORCA-1',
  toolName: null
}

// Why (ORCA-1130): a lead idle since its pane started has sent no hook, so it has no agent row.
describe('buildOrchestratorGameState for a lead that reported no status', () => {
  it('still lists the lead, idle, so its team is drawn', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [MEMBER_ROW],
      leaderPaneKey: 'tab-lead:1',
      leaderUnreported: true,
      terminalHandleOf: (paneKey) => (paneKey === 'tab-lead:1' ? 'term_lead' : null),
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents.find((one) => one.isLeader)).toEqual({
      paneKey: 'tab-lead:1',
      displayName: null,
      agentType: null,
      state: 'idle',
      toolName: null,
      isLeader: true,
      terminalHandle: 'term_lead'
    })
    expect(state.agents.map((one) => one.paneKey)).toEqual(['tab-lead:1', 'tab-m:1'])
  })

  it('adds none when the lead reported elsewhere on this host, which would be a false idle', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [MEMBER_ROW],
      leaderPaneKey: 'tab-lead:1',
      leaderUnreported: false,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents.map((one) => one.paneKey)).toEqual(['tab-m:1'])
  })

  it('adds no lead to a member pane, whose own row is its band', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [],
      leaderPaneKey: 'tab-m:1',
      leaderUnreported: true,
      callerParentPaneKey: 'tab-lead:1',
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents).toEqual([])
  })
})
