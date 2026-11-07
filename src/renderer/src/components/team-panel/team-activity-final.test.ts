import { describe, expect, it } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { teamSoloModelOf, type TeamSoloSession } from '../../../../shared/team-panel-activity-rows'

const PANE = 'tab-1:11111111-1111-4111-8111-111111111111'

function finalOf(entry: TeamSoloSession['entry']): string | null {
  const session: TeamSoloSession = {
    entry,
    repoName: 'orca-oss',
    worktreeName: 'w',
    worktreeId: 'wt-1',
    isPrimary: false,
    host: { kind: 'local' },
    ticket: null,
    pr: null,
    note: null,
    ports: [],
    account: null,
    cacheExpiresAt: null,
    advisor: null
  }
  const tabs = {
    inbox: { kind: 'loading' },
    prs: { kind: 'loading' },
    queue: null,
    machines: { kind: 'loading' }
  } as const
  return (
    teamSoloModelOf({ sessions: [session], selectedPaneKey: null, tabs }).rows[0]?.lastMessage ??
    null
  )
}

// Why (ORCA-1130 D9): Final showed the turn before the one that had just ended.
describe("Activity's Final", () => {
  it('is the last finished turn after two turns, never the one before', () => {
    const store = createTestStore()
    const turn = (n: number, at: number): void => {
      store
        .getState()
        .setAgentStatus(
          PANE,
          { state: 'working', prompt: `turn ${n}`, agentType: 'claude' },
          undefined,
          { updatedAt: at, stateStartedAt: at }
        )
      store.getState().setAgentStatus(
        PANE,
        {
          state: 'done',
          prompt: `turn ${n}`,
          agentType: 'claude',
          lastAssistantMessage: `final ${n}`
        },
        undefined,
        { updatedAt: at + 1, stateStartedAt: at + 1 }
      )
    }
    turn(1, 1_000)
    turn(2, 2_000)

    const entry = store.getState().agentStatusByPaneKey[PANE]
    expect(entry?.lastCompletedAssistantMessage).toBe('final 1')
    expect(finalOf(entry!)).toBe('final 2')
  })

  it('is the last finished turn while the next one runs', () => {
    const store = createTestStore()
    const set = (state: 'working' | 'done', at: number, message?: string): void => {
      store.getState().setAgentStatus(
        PANE,
        {
          state,
          prompt: 'p',
          agentType: 'claude',
          ...(message ? { lastAssistantMessage: message } : {})
        },
        undefined,
        { updatedAt: at, stateStartedAt: at }
      )
    }
    set('working', 1_000)
    set('done', 1_001, 'final 1')
    set('working', 2_000, 'thinking out loud')

    expect(store.getState().agentStatusByPaneKey[PANE]?.lastCompletedAssistantMessage).toBe(
      'final 1'
    )
  })

  it('names no turn when the one that ended carried no message', () => {
    const store = createTestStore()
    const set = (state: 'working' | 'done', at: number, message?: string): void => {
      store.getState().setAgentStatus(
        PANE,
        {
          state,
          prompt: 'p',
          agentType: 'claude',
          ...(message ? { lastAssistantMessage: message } : {})
        },
        undefined,
        { updatedAt: at, stateStartedAt: at }
      )
    }
    set('working', 1_000)
    set('done', 1_001, 'final 1')
    set('working', 2_000)
    set('done', 2_001)

    expect(finalOf(store.getState().agentStatusByPaneKey[PANE]!)).toBeNull()
  })

  it('keeps the finished turn when a session boundary lands on it', () => {
    const store = createTestStore()
    store
      .getState()
      .setAgentStatus(PANE, { state: 'working', prompt: 'p', agentType: 'claude' }, undefined, {
        updatedAt: 1_000,
        stateStartedAt: 1_000
      })
    store
      .getState()
      .setAgentStatus(
        PANE,
        { state: 'done', prompt: 'p', agentType: 'claude', lastAssistantMessage: 'final 1' },
        undefined,
        { updatedAt: 1_001, stateStartedAt: 1_001 }
      )
    store
      .getState()
      .setAgentStatus(
        PANE,
        { state: 'done', prompt: '', agentType: 'claude', sessionBoundary: true },
        undefined,
        { updatedAt: 2_000, stateStartedAt: 2_000 }
      )

    expect(finalOf(store.getState().agentStatusByPaneKey[PANE]!)).toBe('final 1')
  })
})
