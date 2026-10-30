import { describe, expect, it } from 'vitest'
import {
  GAME_MEMBER_BODY_MAX,
  GAME_MEMBER_TERMINAL_LINES,
  gameMemberReportOf
} from './orchestrator-game-member-report'
import type { GameAgent } from './orchestrator-game-state'

const agent: GameAgent = {
  paneKey: 'tab-2:m',
  displayName: 'CIN-5 Seats',
  agentType: 'codex',
  state: 'idle',
  toolName: 'Bash',
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_m',
  worktree: { id: 'repo::/w/cin-5', branch: 'cin-5', displayName: 'cin-5' },
  account: { provider: 'codex', id: 'acct_bo', email: 'bo@example.com' },
  review: {
    provider: 'github',
    number: 41,
    title: 'Seats',
    url: 'https://github.com/o/r/pull/41',
    state: 'open',
    ci: 'failure'
  },
  workItem: {
    provider: 'jira',
    identifier: 'CIN-5',
    title: 'Seats',
    url: 'https://jira/CIN-5',
    status: 'In Progress',
    statusGroup: 'in_progress'
  }
}

const message = (from: string, to: string, type: string, body: string, at: string) => ({
  from_handle: from,
  to_handle: to,
  type,
  subject: `${type} subject`,
  body,
  created_at: at
})

describe('gameMemberReportOf', () => {
  it('says what the member does now: state, phase, tool and its last terminal lines, clean of ANSI', () => {
    const lines = Array.from({ length: 30 }, (_, at) => `\u001b[32mline ${at}\u001b[0m`)
    const report = gameMemberReportOf({
      agent,
      terminalLines: lines,
      dispatches: [],
      current: null,
      messages: [],
      leadHandle: 'term_lead',
      commits: [],
      notes: []
    })

    expect(report).toEqual(
      expect.objectContaining({
        ticket: 'CIN-5',
        agent: 'codex',
        account: 'bo@example.com',
        branch: 'cin-5'
      })
    )
    expect(report.now).toEqual(
      expect.objectContaining({ state: 'idle', phase: 'idle', tool: 'Bash' })
    )
    expect(report.now.terminal).toHaveLength(GAME_MEMBER_TERMINAL_LINES)
    expect(report.now.terminal.at(-1)).toBe('line 29')
    expect(report.now.unsentInput).toBeNull()
  })

  it('marks the text in Claude input box as unsent, never as something the owner sent', () => {
    const rule = '─'.repeat(40)
    const report = gameMemberReportOf({
      agent,
      terminalLines: [
        '⏺ PR #41 is green.',
        rule,
        `\u001b[2m❯ merge now\u001b[0m`,
        rule,
        '  cin-5 · Opus · ctx 10%'
      ],
      dispatches: [],
      current: null,
      messages: [],
      leadHandle: 'term_lead',
      commits: [],
      notes: []
    })

    expect(report.now.unsentInput).toBe('merge now')
    expect(report.now.terminal).toEqual([
      '⏺ PR #41 is green.',
      rule,
      '❯ (unsent: typed or a Claude suggestion) merge now',
      rule,
      '  cin-5 · Opus · ctx 10%'
    ])
  })

  it('leaves an empty input box and a prompt glyph outside it alone', () => {
    const rule = '─'.repeat(40)
    const lines = ['❯ an earlier prompt in the transcript', rule, '❯', rule, '  status']
    const report = gameMemberReportOf({
      agent,
      terminalLines: lines,
      dispatches: [],
      current: null,
      messages: [],
      leadHandle: 'term_lead',
      commits: [],
      notes: []
    })

    expect(report.now.unsentInput).toBeNull()
    expect(report.now.terminal).toEqual(lines)
  })

  it('tells what it did since launch: attempts, messages with the lead in order, commits, PR, CI and ticket', () => {
    const report = gameMemberReportOf({
      agent,
      terminalLines: null,
      dispatches: [
        { dispatchId: 'd1', workerState: 'stopped', terminalState: 'released' },
        { dispatchId: 'd2', workerState: 'ready', terminalState: 'retained' }
      ],
      current: {
        state: 'ready',
        stage: 'agent_ready',
        lastError: null,
        launchedAt: '2026-10-16 10:00:00'
      },
      messages: [
        message(
          'term_m',
          'term_lead',
          'worker_done',
          'x'.repeat(GAME_MEMBER_BODY_MAX + 50),
          '2026-10-16 12:00:00'
        ),
        message('term_lead', 'term_m', 'reply', 'Use the v2 API', '2026-10-16 11:00:00'),
        message('term_m', 'term_lead', 'question', 'Which API?', '2026-10-16 10:30:00'),
        message('term_other', 'term_lead', 'question', 'not ours', '2026-10-16 10:40:00')
      ],
      leadHandle: 'term_lead',
      commits: [{ id: 'abcdef1234567', subject: 'feat: seats', timestamp: 1_000 }],
      notes: ['terminal: closed']
    })

    expect(report.since.dispatches).toEqual([
      { id: 'd1', state: 'stopped' },
      { id: 'd2', state: 'ready', stage: 'agent_ready', launchedAt: '2026-10-16 10:00:00' }
    ])
    expect(report.since.messages.map((one) => [one.from, one.type])).toEqual([
      ['member', 'question'],
      ['lead', 'reply'],
      ['member', 'worker_done']
    ])
    expect(report.since.messages[2]?.body).toHaveLength(GAME_MEMBER_BODY_MAX)
    expect(report.since.lastReport).toEqual(expect.objectContaining({ type: 'worker_done' }))
    expect(report.since.commits).toEqual([
      { id: 'abcdef1', subject: 'feat: seats', at: new Date(1_000).toISOString() }
    ])
    expect(report.since).toEqual(
      expect.objectContaining({
        review: '#41 open',
        ci: 'failure',
        ticketStatus: 'In Progress'
      })
    )
    expect(report.notes).toEqual(['terminal: closed'])
  })
})
