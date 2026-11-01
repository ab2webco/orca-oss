import { describe, expect, it } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import type { GameMemberSession } from '../../shared/orchestrator-game-member-sessions'
import { sleepingTerminalOwnerOf } from './sleeping-terminal-owner'

const RECORD = {
  paneKey: 'tab-1:leaf-1',
  worktreeId: 'repo::/wt-915',
  agent: 'claude',
  providerSession: { key: 'session_id', id: 'conversation-915' }
} as SleepingAgentSessionRecord

const member = (overrides: Partial<GameMemberSession>): GameMemberSession => ({
  ticket: 'ORCA-915',
  name: 'Nova',
  runId: 'run-1',
  taskId: 'task-1',
  dispatchId: null,
  worktreeId: 'repo::/wt-915',
  branch: 'fabolivark/orca-915',
  agent: 'claude',
  accountId: 'acct-1',
  account: 'member@example.com',
  sessionId: 'conversation-915',
  lastState: 'working',
  launchedAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
  ...overrides
})

const leadOfRun = (runId: string): string | null => (runId === 'run-1' ? 'term_lead' : null)

describe('sleepingTerminalOwnerOf', () => {
  it('names the lead, ticket and account of the member whose conversation slept', () => {
    expect(
      sleepingTerminalOwnerOf({
        record: RECORD,
        members: [member({ ticket: 'ORCA-1', sessionId: 'other', worktreeId: 'x' }), member({})],
        leadOfRun,
        pinnedAccount: null
      })
    ).toEqual({ lead: 'term_lead', ticket: 'ORCA-915', account: 'member@example.com' })
  })

  it('falls back to the member of its worktree before the member reported a conversation', () => {
    expect(
      sleepingTerminalOwnerOf({
        record: RECORD,
        members: [member({ sessionId: null, account: null })],
        leadOfRun,
        pinnedAccount: 'pinned@example.com'
      })
    ).toEqual({ lead: 'term_lead', ticket: 'ORCA-915', account: 'pinned@example.com' })
  })

  it('does not claim a finished member of the same worktree', () => {
    expect(
      sleepingTerminalOwnerOf({
        record: RECORD,
        members: [member({ sessionId: null, lastState: 'finished' })],
        leadOfRun,
        pinnedAccount: null
      })
    ).toBeNull()
  })

  it('leaves a pane no member owns without an owner', () => {
    expect(
      sleepingTerminalOwnerOf({ record: RECORD, members: [], leadOfRun, pinnedAccount: null })
    ).toBeNull()
  })
})
