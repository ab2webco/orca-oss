import { describe, expect, it } from 'vitest'
import {
  buildClaudeAccountWorktreeUsageReport,
  type ClaudeAccountUsageInputs
} from './account-worktree-usage-report'

const WORKTREE_A = 'repo-1::/work/feature-a'
const WORKTREE_B = 'repo-1::/work/feature-b'
const WORKTREE_C = 'repo-2::/work/hotfix'

function inputs(overrides: Partial<ClaudeAccountUsageInputs> = {}): ClaudeAccountUsageInputs {
  return {
    accountId: 'account-a',
    worktreeMeta: {
      [WORKTREE_A]: { displayName: 'feature-a', claudeAccountId: 'account-a' },
      [WORKTREE_B]: { displayName: 'feature-b', claudeAccountId: 'account-a' },
      [WORKTREE_C]: { displayName: 'hotfix', claudeAccountId: 'account-b' }
    },
    liveInjectedPtyAccounts: new Map(),
    liveSharedPtyAccounts: new Map(),
    injectedLaunchReservations: new Map(),
    sharedLaunchReservations: new Map(),
    unknownOwnerSharedPtyIds: new Set(),
    activeAccountId: null,
    ...overrides
  }
}

describe('buildClaudeAccountWorktreeUsageReport', () => {
  it('separates a worktree with a live terminal from one that only carries the pin', () => {
    const report = buildClaudeAccountWorktreeUsageReport(
      inputs({
        liveInjectedPtyAccounts: new Map([[`${WORKTREE_A}@@pane-1`, 'account-a']])
      })
    )

    expect(report.worktrees).toEqual([
      { worktreeId: WORKTREE_A, displayName: 'feature-a', hasLiveTerminal: true },
      { worktreeId: WORKTREE_B, displayName: 'feature-b', hasLiveTerminal: false }
    ])
    expect(report.liveTerminalCount).toBe(1)
  })

  it('lists a worktree whose live terminal outlived its pin', () => {
    const report = buildClaudeAccountWorktreeUsageReport(
      inputs({
        worktreeMeta: { [WORKTREE_C]: { displayName: 'hotfix', claudeAccountId: 'account-b' } },
        liveInjectedPtyAccounts: new Map([[`${WORKTREE_C}@@pane-1`, 'account-a']])
      })
    )

    expect(report.worktrees).toEqual([
      { worktreeId: WORKTREE_C, displayName: 'hotfix', hasLiveTerminal: true }
    ])
  })

  it('counts shared PTYs of unknown owner the same way the force-close does', () => {
    const report = buildClaudeAccountWorktreeUsageReport(
      inputs({
        liveSharedPtyAccounts: new Map([
          [`${WORKTREE_A}@@pane-1`, null],
          [`${WORKTREE_C}@@pane-1`, 'account-b']
        ]),
        unknownOwnerSharedPtyIds: new Set([`${WORKTREE_A}@@pane-1`])
      })
    )

    expect(report.liveTerminalCount).toBe(1)
    expect(report.worktrees.find((w) => w.worktreeId === WORKTREE_A)?.hasLiveTerminal).toBe(true)
  })

  it('ignores a shared PTY known to own no managed account', () => {
    const report = buildClaudeAccountWorktreeUsageReport(
      inputs({
        liveSharedPtyAccounts: new Map([[`${WORKTREE_A}@@pane-1`, null]]),
        unknownOwnerSharedPtyIds: new Set()
      })
    )

    expect(report.liveTerminalCount).toBe(0)
    expect(report.worktrees.find((w) => w.worktreeId === WORKTREE_A)?.hasLiveTerminal).toBe(false)
  })

  it('reports launch reservations the live-terminal count cannot see', () => {
    const report = buildClaudeAccountWorktreeUsageReport(
      inputs({
        injectedLaunchReservations: new Map([['reservation-1', 'account-a']]),
        sharedLaunchReservations: new Map([
          ['reservation-2', null],
          ['reservation-3', 'account-b']
        ])
      })
    )

    expect(report.liveTerminalCount).toBe(0)
    expect(report.pendingLaunchCount).toBe(1)
    expect(report.pendingGlobalLaunchCount).toBe(1)
  })

  it('names the active account whose live terminal blocks a change to another account', () => {
    const report = buildClaudeAccountWorktreeUsageReport(
      inputs({
        activeAccountId: 'account-b',
        liveInjectedPtyAccounts: new Map([[`${WORKTREE_C}@@pane-1`, 'account-b']])
      })
    )

    expect(report.blockedByOtherAccounts).toEqual([
      {
        ptyId: `${WORKTREE_C}@@pane-1`,
        accountId: 'account-b',
        worktreeId: WORKTREE_C,
        displayName: 'hotfix'
      }
    ])
  })

  it('does not report the account being changed as its own blocker', () => {
    const report = buildClaudeAccountWorktreeUsageReport(
      inputs({
        activeAccountId: 'account-a',
        liveInjectedPtyAccounts: new Map([[`${WORKTREE_A}@@pane-1`, 'account-a']])
      })
    )

    expect(report.blockedByOtherAccounts).toEqual([])
  })

  it('falls back to the worktree path when no display name is stored', () => {
    const report = buildClaudeAccountWorktreeUsageReport(
      inputs({ worktreeMeta: { [WORKTREE_A]: { claudeAccountId: 'account-a' } } })
    )

    expect(report.worktrees[0]?.displayName).toBe('/work/feature-a')
  })
})
