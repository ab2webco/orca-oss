import { describe, expect, it } from 'vitest'
import { formatTerminalFocus, formatTerminalList } from './terminal-format'

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
