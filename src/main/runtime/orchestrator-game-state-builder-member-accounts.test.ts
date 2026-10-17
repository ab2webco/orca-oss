import { describe, expect, it } from 'vitest'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

const row = {
  state: 'working' as const,
  agentType: 'claude',
  displayName: null,
  taskTitle: null,
  toolName: null
}

describe('buildOrchestratorGameState member accounts', () => {
  it("names the account each member runs on, from the member's own pane and worktree", async () => {
    const asked: unknown[] = []
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-4:here', parentPaneKey: 'tab-1:lead', taskTitle: 'CIN-7' }
      ],
      members: [
        {
          row: { ...row, paneKey: 'tab-6:away', agentType: 'codex', taskTitle: 'CIN-8' },
          worktree: { id: 'wt-cin-8', branch: 'feat/cin-8', displayName: 'cin-8' }
        }
      ],
      leaderPaneKey: 'tab-1:lead',
      accountOf: (member) => {
        asked.push(member)
        return member.agentType === 'codex'
          ? { provider: 'codex', id: 'acct_bo', email: 'bo@example.com' }
          : null
      },
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(asked).toEqual([
      { paneKey: 'tab-4:here', agentType: 'claude', worktreeId: null },
      { paneKey: 'tab-6:away', agentType: 'codex', worktreeId: 'wt-cin-8' }
    ])
    expect(state.agents.map((agent) => [agent.paneKey, agent.account])).toEqual([
      ['tab-1:lead', undefined],
      ['tab-4:here', undefined],
      ['tab-6:away', { provider: 'codex', id: 'acct_bo', email: 'bo@example.com' }]
    ])
  })
})
