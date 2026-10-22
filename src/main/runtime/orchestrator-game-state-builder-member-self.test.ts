import { describe, expect, it } from 'vitest'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

describe('buildOrchestratorGameState for a member pane', () => {
  it('keeps a member pane its own row, so its band can name it', async () => {
    const self = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: 'Arthur · CIN-12',
      taskTitle: null,
      toolName: null,
      paneKey: 'tab:member',
      parentPaneKey: 'tab:lead'
    }
    const member = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [self, { ...self, paneKey: 'tab:other', displayName: 'Lancelot · CIN-13' }],
      leaderPaneKey: 'tab:member',
      callerParentPaneKey: 'tab:lead',
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(member.agents.map((one) => [one.displayName, one.isLeader])).toEqual([
      ['Arthur · CIN-12', true]
    ])
  })
})
