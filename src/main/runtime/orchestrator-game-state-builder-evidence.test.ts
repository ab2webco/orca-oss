import { describe, expect, it } from 'vitest'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

const row = {
  agentType: 'claude',
  displayName: null,
  taskTitle: null,
  toolName: null,
  parentPaneKey: 'tab-1:lead'
}

// Why (ORCA-1395): the fleet had no hook age, restart mark or sleep flag to say a state is unproven.
describe('buildOrchestratorGameState member evidence', () => {
  it("carries each member's hook time, a restored row's mark and a sleeping pane's wake handle", async () => {
    const asleepOf: string[] = []
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead', parentPaneKey: null, state: 'working', updatedAt: 1 },
        { ...row, paneKey: 'tab-1:busy', state: 'working', updatedAt: 5_000 },
        {
          ...row,
          paneKey: 'tab-1:back',
          state: 'working',
          updatedAt: 3_000,
          restoredUnconfirmed: true
        },
        { ...row, paneKey: 'tab-1:slept', state: 'done', updatedAt: 2_000 }
      ],
      leaderPaneKey: 'tab-1:lead',
      asleepHandleOf: ({ paneKey }) => {
        asleepOf.push(paneKey)
        return paneKey === 'tab-1:slept' ? 'term_wake' : null
      },
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    const byPane = Object.fromEntries(
      state.agents.map((agent) => [
        agent.paneKey,
        [agent.state, agent.hookAt, agent.restored, agent.asleepHandle]
      ])
    )
    expect(byPane).toEqual({
      'tab-1:lead': ['working', undefined, undefined, undefined],
      'tab-1:busy': ['working', 5_000, undefined, undefined],
      'tab-1:back': ['idle', 3_000, true, undefined],
      'tab-1:slept': ['done', 2_000, undefined, 'term_wake']
    })
    // Why: the lead's own pane is no fleet row, so its sleep is never read.
    expect(asleepOf).not.toContain('tab-1:lead')
  })
})
