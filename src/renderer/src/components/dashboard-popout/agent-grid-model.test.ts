import { describe, expect, it } from 'vitest'
import type {
  AgentSessionLogPaneReading,
  AgentSessionLogReading
} from '../../../../shared/agent-session-log-state'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { agentGridDotState, buildAgentGrid, buildAgentGridCell } from './agent-grid-model'

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'tab1:leaf1',
    ptyId: 'p1',
    agentType: 'claude',
    bucket: 'working',
    dotState: 'working',
    task: 'the task',
    repoId: 'r1',
    worktreeId: 'w1',
    tabId: 'tab1',
    leafId: 'l1',
    repoName: 'Repo',
    worktreeName: 'wt',
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false,
    ...overrides
  }
}

function reading(session: AgentSessionLogReading, paneKey = 'tab1:leaf1'): AgentSessionLogPaneReading {
  return { paneKey, agent: 'claude', sessionId: 's1', session }
}

function readable(overrides: Partial<Extract<AgentSessionLogReading, { read: true }>> = {}) {
  return {
    read: true as const,
    state: 'awaiting-input' as const,
    lastTurnAtMs: 5_000,
    queuedInput: { supported: true as const, pending: 0 },
    unparsedRecords: 0,
    ...overrides
  }
}

describe('buildAgentGridCell', () => {
  it('prefers the log prose over the hook-derived card text', () => {
    const cell = buildAgentGridCell(
      card({ lastAgentMessage: 'from the hook' }),
      reading(
        readable({
          activity: {
            lastAssistantText: 'from the log',
            pendingToolName: 'Bash',
            atMs: 5_000,
            textBeyondScan: false
          }
        })
      )
    )
    expect(cell).toMatchObject({
      activityText: 'from the log',
      pendingToolName: 'Bash',
      activitySource: 'session-log',
      activeSinceMs: 5_000
    })
  })

  it('falls back to the hook text when the log carries no prose', () => {
    const cell = buildAgentGridCell(
      card({ lastAgentMessage: 'from the hook' }),
      reading(readable())
    )
    expect(cell).toMatchObject({ activityText: 'from the hook', activitySource: 'hook' })
  })

  it('keeps the unread reason so an unreadable log never looks like a silent agent', () => {
    const cell = buildAgentGridCell(
      card({ lastAgentMessage: undefined, task: undefined, askSummary: undefined }),
      reading({ read: false, reason: 'session-log-missing' })
    )
    expect(cell).toMatchObject({
      activityText: null,
      activitySource: 'none',
      unreadReason: 'session-log-missing',
      logState: null
    })
  })

  it('surfaces outstanding queued input', () => {
    const cell = buildAgentGridCell(
      card(),
      reading(readable({ state: 'queued-input', queuedInput: { supported: true, pending: 2 } }))
    )
    expect(cell).toMatchObject({ queuedInput: 2, dotState: 'working' })
  })

  it('reports beyond-scan prose as unseen rather than absent', () => {
    const cell = buildAgentGridCell(
      card({ lastAgentMessage: undefined, task: undefined }),
      reading(
        readable({
          activity: {
            lastAssistantText: null,
            pendingToolName: null,
            atMs: null,
            textBeyondScan: true
          }
        })
      )
    )
    expect(cell).toMatchObject({ activityText: null, textBeyondScan: true })
  })
})

describe('agentGridDotState', () => {
  it('lets the hook keep a permission prompt, which the transcript never records', () => {
    expect(agentGridDotState('working', card({ dotState: 'blocked' }))).toBe('blocked')
  })

  it('trusts the log over a stale hook state for a live turn', () => {
    expect(agentGridDotState('working', card({ dotState: 'done' }))).toBe('working')
  })

  it('settles to done when the log says the turn ended', () => {
    expect(agentGridDotState('awaiting-input', card({ dotState: 'working' }))).toBe('done')
  })

  it('keeps a waiting hook state when the log only knows the turn ended', () => {
    expect(agentGridDotState('awaiting-input', card({ dotState: 'waiting' }))).toBe('waiting')
  })

  it('falls back to the hook state when the log is unreadable', () => {
    expect(agentGridDotState(null, card({ dotState: 'interrupted' }))).toBe('interrupted')
  })
})

describe('buildAgentGrid', () => {
  it('groups by project and puts the agents needing attention first', () => {
    const cards = [
      card({ paneKey: 'a', repoId: 'r2', repoName: 'Zed', dotState: 'working' }),
      card({ paneKey: 'b', repoId: 'r1', repoName: 'Alpha', dotState: 'done', stateChangedAt: 1 }),
      card({ paneKey: 'c', repoId: 'r1', repoName: 'Alpha', dotState: 'blocked' }),
      card({ paneKey: 'd', repoId: 'r1', repoName: 'Alpha', dotState: 'working' })
    ]
    const grid = buildAgentGrid(cards, new Map())
    expect(grid.map((project) => project.repoName)).toEqual(['Alpha', 'Zed'])
    expect(grid[0].cells.map((cell) => cell.card.paneKey)).toEqual(['c', 'd', 'b'])
  })

  it('joins readings to cards by pane key, leaving unmatched cards on the hook fallback', () => {
    const cards = [card({ paneKey: 'a' }), card({ paneKey: 'b', lastAgentMessage: 'hook b' })]
    const grid = buildAgentGrid(
      cards,
      new Map([
        [
          'a',
          reading(
            readable({
              activity: {
                lastAssistantText: 'log a',
                pendingToolName: null,
                atMs: 1,
                textBeyondScan: false
              }
            }),
            'a'
          )
        ]
      ])
    )
    const byPane = new Map(grid[0].cells.map((cell) => [cell.card.paneKey, cell]))
    expect(byPane.get('a')?.activityText).toBe('log a')
    expect(byPane.get('b')?.activityText).toBe('hook b')
  })
})
