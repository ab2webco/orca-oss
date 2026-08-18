import { describe, expect, it } from 'vitest'
import {
  formatTerminalAgentSessionState,
  formatTerminalCreate,
  formatTerminalFocus,
  formatTerminalList
} from './terminal-format'

describe('formatTerminalCreate', () => {
  it('surfaces spawn-time readiness before a caller writes', () => {
    expect(
      formatTerminalCreate({
        terminal: {
          handle: 'term_starting',
          worktreeId: 'wt-1',
          title: 'Worker',
          connected: false,
          writable: false,
          liveness: 'starting'
        }
      })
    ).toBe(
      'Created terminal term_starting (title: "Worker") [connected: false, writable: false, liveness: starting]'
    )
  })
})

describe('formatTerminalFocus', () => {
  it('distinguishes superseded navigation from a winning focus', () => {
    expect(
      formatTerminalFocus({
        focus: {
          handle: 'term_stale',
          tabId: 'tab-stale',
          worktreeId: 'worktree-1',
          navigated: false
        }
      })
    ).toBe(
      'Focus request for terminal term_stale was superseded or host navigation was skipped (tab tab-stale).'
    )
    expect(
      formatTerminalFocus({
        focus: { handle: 'term_winner', tabId: 'tab-winner', worktreeId: 'worktree-1' }
      })
    ).toBe('Focused terminal term_winner (tab tab-winner).')
  })
})

describe('formatTerminalList liveness', () => {
  // Why: the human column used to print connected/disconnected, which cannot
  // separate a sleeping agent from a dead pane any better than absence could.
  it('labels a sleeping worker distinctly from a dead pane', () => {
    const output = formatTerminalList({
      terminals: [
        {
          handle: 'term_asleep',
          ptyId: null,
          worktreeId: 'wt-1',
          worktreePath: '/repo',
          branch: 'main',
          tabId: 'tab-worker',
          leafId: 'leaf-worker',
          title: 'Worker',
          connected: false,
          writable: false,
          liveness: 'sleeping',
          lastOutputAt: null,
          preview: '',
          sleepingAgent: {
            agent: 'claude',
            paneKey: 'tab-worker:leaf-worker',
            stateAtSleep: 'working',
            capturedAt: 1
          }
        },
        {
          handle: 'term_dead',
          ptyId: null,
          worktreeId: 'wt-1',
          worktreePath: '/repo',
          branch: 'main',
          tabId: 'tab-dead',
          leafId: 'leaf-dead',
          title: 'Dead',
          connected: false,
          writable: false,
          liveness: 'gone',
          lastOutputAt: null,
          preview: ''
        }
      ],
      totalCount: 2,
      truncated: false
    })

    expect(output).toContain('term_asleep  Worker  sleeping (claude, wake to resume)')
    expect(output).toContain('term_dead  Dead  gone')
    expect(output).not.toContain('disconnected')
  })

  it('does not claim there are no live terminals when the list is empty', () => {
    expect(formatTerminalList({ terminals: [], totalCount: 0, truncated: false })).toBe(
      'No terminals.'
    )
  })
})

describe('formatTerminalAgentSessionState', () => {
  const base = { handle: 'term-1', agent: 'claude', sessionId: 'session-1' }

  it('prints the state, the last turn and the queue depth', () => {
    const output = formatTerminalAgentSessionState({
      agentSession: {
        ...base,
        session: {
          read: true,
          state: 'queued-input',
          lastTurnAtMs: Date.parse('2026-07-24T03:15:59.000Z'),
          queuedInput: { supported: true, pending: 2 },
          unparsedRecords: 0
        }
      }
    })
    expect(output).toContain('state: queued-input')
    expect(output).toContain('last turn: 2026-07-24T03:15:59.000Z')
    expect(output).toContain('queued input: 2')
  })

  it('says queued input is unobservable instead of printing a zero', () => {
    const output = formatTerminalAgentSessionState({
      agentSession: {
        ...base,
        agent: 'codex',
        session: {
          read: true,
          state: 'awaiting-input',
          lastTurnAtMs: null,
          queuedInput: { supported: false, reason: 'no queued-input records' },
          unparsedRecords: 3
        }
      }
    })
    expect(output).toContain('queued input: unobservable — no queued-input records')
    expect(output).toContain('last turn: none in the session log')
    expect(output).toContain('warning: 3 session-log records could not be parsed')
  })

  it('names why the state is unknown rather than defaulting to one', () => {
    const output = formatTerminalAgentSessionState({
      agentSession: {
        handle: 'term-1',
        agent: null,
        sessionId: null,
        session: { read: false, reason: 'agent-session-unknown' }
      }
    })
    expect(output).toContain('agent: unknown')
    expect(output).toContain('state: unknown — no agent session is identified for this pane yet')
  })
})
