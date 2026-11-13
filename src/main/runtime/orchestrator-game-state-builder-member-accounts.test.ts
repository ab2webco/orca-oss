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
      { paneKey: 'tab-6:away', agentType: 'codex', worktreeId: 'wt-cin-8' },
      { paneKey: 'tab-1:lead', agentType: 'claude', worktreeId: null }
    ])
    expect(state.agents.map((agent) => [agent.paneKey, agent.account])).toEqual([
      ['tab-1:lead', undefined],
      ['tab-4:here', undefined],
      ['tab-6:away', { provider: 'codex', id: 'acct_bo', email: 'bo@example.com' }]
    ])
  })

  it("names the lead's own account apart from its agent row, so older clients see the same agents", async () => {
    const lead = { provider: 'claude' as const, id: 'acct_maya', email: 'maya@example.com' }
    const input = {
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-4:here', parentPaneKey: 'tab-1:lead' }
      ],
      leaderPaneKey: 'tab-1:lead',
      readReview: none,
      readPlane: none,
      readLinear: none
    }

    const named = await buildOrchestratorGameState({
      ...input,
      accountOf: (member) => (member.paneKey === 'tab-1:lead' ? lead : null)
    })
    const unknown = await buildOrchestratorGameState({ ...input, accountOf: () => null })

    expect(named.leadAccount).toEqual(lead)
    expect(named.agents.find((agent) => agent.paneKey === 'tab-1:lead')?.account).toBeUndefined()
    expect('leadAccount' in unknown).toBe(false)
  })

  it('flags a member on the global login, never the lead or a member with a managed account', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-4:global', parentPaneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-5:managed', parentPaneKey: 'tab-1:lead' }
      ],
      leaderPaneKey: 'tab-1:lead',
      accountOf: (member) =>
        member.paneKey === 'tab-5:managed'
          ? { provider: 'claude', id: 'acct_ana', email: 'ana@example.com' }
          : null,
      globalLoginOf: () => true,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents.map((agent) => [agent.paneKey, agent.globalLogin])).toEqual([
      ['tab-1:lead', undefined],
      ['tab-4:global', true],
      ['tab-5:managed', undefined]
    ])
  })

  it('marks a member its account limit stopped, asking only for members', async () => {
    const asked: unknown[] = []
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-4:here', parentPaneKey: 'tab-1:lead', state: 'done' }
      ],
      leaderPaneKey: 'tab-1:lead',
      accountOf: () => ({ provider: 'claude', id: 'acct_ana', email: 'ana@example.com' }),
      limitOf: async (member) => {
        asked.push(member)
        return { resetsAt: 123 }
      },
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(asked).toEqual([
      {
        paneKey: 'tab-4:here',
        agentType: 'claude',
        state: 'done',
        account: { provider: 'claude', id: 'acct_ana', email: 'ana@example.com' }
      }
    ])
    expect(state.agents.map((agent) => [agent.paneKey, agent.limit])).toEqual([
      ['tab-1:lead', undefined],
      ['tab-4:here', { resetsAt: 123 }]
    ])
  })

  it("carries the lead's and each member's Jev report, asking for no other pane", async () => {
    const asked: string[] = []
    const leadJev = {
      model: 'Opus 5.5',
      effort: 'high',
      line: 'Reviewing the plan',
      pinned: { model: false, effort: false }
    }
    const jev = {
      model: 'Sonnet 5.5',
      effort: 'high',
      pinned: { model: true, effort: false },
      previous: { model: 'Opus 5.5', effort: 'high' }
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-4:here', parentPaneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-5:quiet', parentPaneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-6:apart' }
      ],
      leaderPaneKey: 'tab-1:lead',
      advisorOf: (paneKey) => {
        asked.push(paneKey)
        return paneKey === 'tab-1:lead' ? leadJev : paneKey === 'tab-4:here' ? jev : null
      },
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(asked).toEqual(['tab-1:lead', 'tab-4:here', 'tab-5:quiet'])
    expect(state.agents.map((agent) => [agent.paneKey, agent.advisor])).toEqual([
      ['tab-1:lead', leadJev],
      ['tab-4:here', jev],
      ['tab-5:quiet', undefined],
      ['tab-6:apart', undefined]
    ])
  })

  it('carries the model and effort Orca launched each member on, asking only for members', async () => {
    const asked: string[] = []
    const launch = { model: 'Opus 5.5', effort: 'high' }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-4:here', parentPaneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-5:typed', parentPaneKey: 'tab-1:lead' }
      ],
      leaderPaneKey: 'tab-1:lead',
      launchOf: (paneKey) => {
        asked.push(paneKey)
        return paneKey === 'tab-4:here' ? launch : null
      },
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(asked).toEqual(['tab-4:here', 'tab-5:typed'])
    expect(state.agents.map((agent) => [agent.paneKey, agent.launch])).toEqual([
      ['tab-1:lead', undefined],
      ['tab-4:here', launch],
      ['tab-5:typed', undefined]
    ])
  })
})
