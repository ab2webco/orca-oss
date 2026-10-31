import { describe, expect, it } from 'vitest'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

// The fleet half of buildOrchestratorGameState: which panes are members and what each carries.
describe('buildOrchestratorGameState fleet', () => {
  it('hands out the terminal handle of each agent pane that maps to one', async () => {
    const row = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: 'dev',
      taskTitle: null,
      toolName: null
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab:a' },
        { ...row, paneKey: 'tab:gone' }
      ],
      leaderPaneKey: null,
      terminalHandleOf: (paneKey) => (paneKey === 'tab:a' ? 'term_a' : null),
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents[0]?.terminalHandle).toBe('term_a')
    // Why: an absent key, not null, keeps the row identical to what older hosts send.
    expect(state.agents[1]).not.toHaveProperty('terminalHandle')
  })

  // Why: one worktree can host several Teams; a band counting another Team's agents misleads.
  it("keeps only the calling team's panes when the team is known", async () => {
    const row = {
      state: 'done' as const,
      agentType: 'claude',
      displayName: null,
      taskTitle: null,
      toolName: null
    }
    const handles: Record<string, string> = {
      'tab-1:lead': 'term_lead',
      'tab-1:mate': 'term_mate',
      'tab-2:other-lead': 'term_other',
      'tab-3:moved-mate': 'term_moved'
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: Object.keys(handles).map((paneKey) => ({ ...row, paneKey })),
      leaderPaneKey: 'tab-1:lead',
      terminalHandleOf: (paneKey) => handles[paneKey] ?? null,
      teamHandles: new Set(['term_lead', 'term_mate', 'term_moved']),
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents.map((agent) => agent.paneKey)).toEqual([
      'tab-1:lead',
      'tab-1:mate',
      'tab-3:moved-mate'
    ])
  })

  it('counts the members the lead launched, in its worktree or in their own, as the fleet', async () => {
    const row = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: null,
      taskTitle: null,
      toolName: null
    }
    const handles: Record<string, string> = {
      'tab-1:lead': 'term_lead',
      'tab-1:mate': 'term_mate',
      'tab-4:here': 'term_here',
      'tab-5:stranger': 'term_stranger'
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-1:mate' },
        { ...row, paneKey: 'tab-4:here', parentPaneKey: 'tab-1:lead', taskTitle: 'CIN-7 Login' },
        { ...row, paneKey: 'tab-5:stranger', parentPaneKey: 'tab-9:other-lead' }
      ],
      members: [
        {
          row: { ...row, paneKey: 'tab-6:away', taskTitle: 'CIN-8 Seats', state: 'blocked' },
          worktree: { id: 'wt-cin-8', branch: 'feat/cin-8', displayName: 'cin-8' }
        }
      ],
      leaderPaneKey: 'tab-1:lead',
      terminalHandleOf: (paneKey) =>
        handles[paneKey] ?? (paneKey === 'tab-6:away' ? 'term_away' : null),
      teamHandles: new Set(['term_lead', 'term_mate']),
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(
      state.agents.map((agent) => [agent.paneKey, agent.displayName, agent.isMember ?? false])
    ).toEqual([
      ['tab-1:lead', null, false],
      ['tab-1:mate', null, false],
      ['tab-4:here', 'CIN-7 Login', true],
      ['tab-6:away', 'CIN-8 Seats', true]
    ])
    expect(state.agents[3]).toMatchObject({
      state: 'waiting',
      terminalHandle: 'term_away',
      worktree: { id: 'wt-cin-8', branch: 'feat/cin-8', displayName: 'cin-8' }
    })
  })

  it("carries a member's last activity, state start and orphaned mark, never a non-member's (ORCA-658, ORCA-864)", async () => {
    const row = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: null,
      taskTitle: null,
      toolName: null,
      lastActivityAt: '2026-10-22T12:00:00.000Z',
      stateStartedAt: 1_700,
      orphaned: true
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-4:member', parentPaneKey: 'tab-1:lead', taskTitle: 'CIN-7' }
      ],
      members: [],
      leaderPaneKey: 'tab-1:lead',
      terminalHandleOf: () => null,
      teamHandles: null,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents[1]).toMatchObject({
      isMember: true,
      lastActivityAt: '2026-10-22T12:00:00.000Z',
      stateSince: 1_700,
      orphaned: true
    })
    expect(state.agents[0]).not.toHaveProperty('orphaned')
    expect(state.agents[0]).not.toHaveProperty('lastActivityAt')
    expect(state.agents[0]).not.toHaveProperty('stateSince')
  })

  it("gives each member in its own worktree that worktree's PR, CI and ticket", async () => {
    const row = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: null,
      taskTitle: 'CIN-8 Seats',
      toolName: null
    }
    const asked: string[] = []
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [],
      members: [
        {
          row: { ...row, paneKey: 'tab-6:away' },
          worktree: { id: 'wt-cin-8', branch: 'feat/cin-8', displayName: 'cin-8' }
        },
        {
          row: { ...row, paneKey: 'tab-7:quiet' },
          worktree: { id: 'wt-cin-9', branch: 'feat/cin-9', displayName: 'cin-9' }
        }
      ],
      leaderPaneKey: 'tab-1:lead',
      readReview: none,
      readPlane: none,
      readLinear: none,
      readLinkedStatus: async () => ({ name: 'QA', group: 'review' }),
      readMemberWork: async (worktreeId) => {
        asked.push(worktreeId)
        return worktreeId === 'wt-cin-8'
          ? {
              review: {
                provider: 'github',
                number: 12,
                title: 'Seats',
                url: 'https://github.com/o/r/pull/12',
                state: 'open',
                status: 'failure'
              },
              linkedWorkItem: {
                provider: 'jira',
                type: 'issue',
                number: 0,
                title: 'Seats',
                url: 'https://jira.example/browse/CIN-8',
                jiraIdentifier: 'CIN-8'
              }
            }
          : null
      }
    })

    expect(asked).toEqual(['wt-cin-8', 'wt-cin-9'])
    expect(state.agents[0]).toMatchObject({
      review: { number: 12, ci: 'failure', url: 'https://github.com/o/r/pull/12' },
      workItem: { identifier: 'CIN-8', status: 'QA', statusGroup: 'review' }
    })
    expect(state.agents[1]).not.toHaveProperty('review')
    expect(state.agents[1]).not.toHaveProperty('workItem')
  })

  it('adds every other session the lead did not launch as a found member, with its worktree, account and work (ORCA-914)', async () => {
    const row = {
      state: 'working' as const,
      agentType: 'codex',
      displayName: null,
      taskTitle: null,
      toolName: null,
      lastActivityAt: '2026-10-30T12:00:00.000Z'
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [{ ...row, paneKey: 'tab-1:lead', agentType: 'claude' }],
      members: [
        {
          row: { ...row, paneKey: 'tab-4:launched', taskTitle: 'CIN-7' },
          worktree: { id: 'wt-cin-7', branch: 'cin-7', displayName: 'cin-7' }
        }
      ],
      found: [
        // Why: a launched member and the lead are already listed; found never lists them twice.
        {
          row: { ...row, paneKey: 'tab-4:launched' },
          worktree: { id: 'wt-cin-7', branch: 'cin-7', displayName: 'cin-7' }
        },
        {
          row: { ...row, paneKey: 'tab-1:lead' },
          worktree: { id: 'wt-lead', branch: 'main', displayName: 'lead' }
        },
        {
          row: { ...row, paneKey: 'tab-8:plain' },
          worktree: { id: 'wt-914', branch: 'fabolivark/orca-914', displayName: 'orca-914' }
        }
      ],
      leaderPaneKey: 'tab-1:lead',
      terminalHandleOf: (paneKey) => (paneKey === 'tab-8:plain' ? 'term_plain' : null),
      accountOf: (seat) =>
        seat.worktreeId === 'wt-914'
          ? { provider: 'codex', id: 'acct_bo', email: 'bo@example.com' }
          : null,
      readMemberWork: async (worktreeId) =>
        worktreeId === 'wt-914'
          ? {
              review: {
                provider: 'github',
                number: 99,
                title: 'Found',
                url: 'https://github.com/o/r/pull/99',
                state: 'open',
                status: 'pending'
              },
              linkedWorkItem: null
            }
          : null,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents.map((agent) => [agent.paneKey, agent.found ?? false])).toEqual([
      ['tab-1:lead', false],
      ['tab-4:launched', false],
      ['tab-8:plain', true]
    ])
    expect(state.agents[2]).toMatchObject({
      displayName: 'orca-914',
      agentType: 'codex',
      isMember: true,
      terminalHandle: 'term_plain',
      worktree: { id: 'wt-914', branch: 'fabolivark/orca-914' },
      account: { email: 'bo@example.com' },
      review: { number: 99, ci: 'pending' },
      lastActivityAt: '2026-10-30T12:00:00.000Z'
    })
  })

  it('reads no found sessions for a member pane, whose band lists only itself', async () => {
    const row = {
      state: 'done' as const,
      agentType: 'claude',
      displayName: null,
      taskTitle: null,
      toolName: null
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [{ ...row, paneKey: 'tab-4:member', parentPaneKey: 'tab-1:lead' }],
      found: [
        {
          row: { ...row, paneKey: 'tab-8:plain' },
          worktree: { id: 'wt-914', branch: 'b', displayName: 'orca-914' }
        }
      ],
      leaderPaneKey: 'tab-4:member',
      callerParentPaneKey: 'tab-1:lead',
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents.map((agent) => agent.paneKey)).toEqual(['tab-4:member'])
  })
})
