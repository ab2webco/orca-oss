import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { whoIsWaitingOnUser, type ArcadeHoldSources } from './arcade-hold'

const NOW = Date.parse('2026-11-15T16:00:00Z')
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000

const entry = (
  paneKey: string,
  state: AgentStatusEntry['state'],
  ago: number,
  extra: Partial<AgentStatusEntry> = {}
): AgentStatusEntry => ({
  state,
  prompt: '',
  updatedAt: NOW - ago,
  stateStartedAt: NOW - ago,
  paneKey,
  stateHistory: [],
  ...extra
})

const tab = (id: string, worktreeId: string, extra: Partial<TerminalTab> = {}): TerminalTab => ({
  id,
  ptyId: null,
  worktreeId,
  title: '✳ Claude Code',
  defaultTitle: 'Terminal 2',
  customTitle: null,
  color: null,
  sortOrder: 0,
  createdAt: 0,
  ...extra
})

// The owner's report: a Claude that slept two days ago in another project, waiting at sleep time.
const sleepingElsewhere: ArcadeHoldSources = {
  agentStatusByPaneKey: {
    'tab-cronos:leaf': entry('tab-cronos:leaf', 'waiting', TWO_DAYS, {
      worktreeId: 'cronos-netsat'
    })
  },
  ptyIdsByTabId: { 'tab-cronos': [] },
  tabsByWorktree: { 'cronos-netsat': [tab('tab-cronos', 'cronos-netsat', { ptyId: 'old-pty' })] }
}

describe('whoIsWaitingOnUser', () => {
  it('does not hold for a sleeping pane left waiting two days ago in another project', () => {
    expect(whoIsWaitingOnUser(sleepingElsewhere, NOW)).toBeNull()
  })

  it('does not hold for a sleeping pane even when its row looks fresh', () => {
    const fresh = {
      ...sleepingElsewhere,
      agentStatusByPaneKey: { 'tab-cronos:leaf': entry('tab-cronos:leaf', 'waiting', 1_000) }
    }
    expect(whoIsWaitingOnUser(fresh, NOW)).toBeNull()
  })

  it('does not hold for a restored row no live hook has confirmed', () => {
    const restored: ArcadeHoldSources = {
      agentStatusByPaneKey: {
        'tab-1:leaf': entry('tab-1:leaf', 'blocked', 1_000, { restoredUnconfirmed: true })
      },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      tabsByWorktree: { wt: [tab('tab-1', 'wt')] }
    }
    expect(whoIsWaitingOnUser(restored, NOW)).toBeNull()
  })

  it('holds for a live member blocked on a permission, in any project, and names it', () => {
    const live: ArcadeHoldSources = {
      agentStatusByPaneKey: {
        ...sleepingElsewhere.agentStatusByPaneKey,
        'tab-m:leaf': entry('tab-m:leaf', 'blocked', 5_000, {
          orchestration: { taskId: 't', dispatchId: 'd', displayName: 'Luigi' }
        })
      },
      ptyIdsByTabId: { ...sleepingElsewhere.ptyIdsByTabId, 'tab-m': ['pty-m'] },
      tabsByWorktree: { ...sleepingElsewhere.tabsByWorktree, other: [tab('tab-m', 'other')] }
    }
    expect(whoIsWaitingOnUser(live, NOW)).toEqual({ paneKey: 'tab-m:leaf', name: 'Luigi' })
  })

  it("names a plain agent by its tab's title, and the one waiting longest first", () => {
    const two: ArcadeHoldSources = {
      agentStatusByPaneKey: {
        'tab-a:leaf': entry('tab-a:leaf', 'waiting', 2_000),
        'tab-b:leaf': entry('tab-b:leaf', 'waiting', 9_000)
      },
      ptyIdsByTabId: { 'tab-a': ['pty-a'], 'tab-b': ['pty-b'] },
      tabsByWorktree: {
        wt: [tab('tab-a', 'wt', { customTitle: 'Review' }), tab('tab-b', 'wt')]
      }
    }
    expect(whoIsWaitingOnUser(two, NOW)).toEqual({ paneKey: 'tab-b:leaf', name: 'Claude Code' })
  })

  it('does not hold for a live agent that is working or done', () => {
    const busy: ArcadeHoldSources = {
      agentStatusByPaneKey: {
        'tab-1:a': entry('tab-1:a', 'working', 1_000),
        'tab-1:b': entry('tab-1:b', 'done', 1_000)
      },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      tabsByWorktree: { wt: [tab('tab-1', 'wt')] }
    }
    expect(whoIsWaitingOnUser(busy, NOW)).toBeNull()
  })
})
