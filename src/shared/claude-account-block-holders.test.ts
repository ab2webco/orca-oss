import { describe, expect, it } from 'vitest'
import {
  claudeAccountHoldersMessage,
  describeClaudeAccountHolders
} from './claude-account-block-holders'
import {
  emptyClaudeAccountWorktreeUsageReport,
  type ClaudeAccountWorktreeUsageReport
} from './claude-account-worktree-usage'

function report(
  overrides: Partial<ClaudeAccountWorktreeUsageReport> = {}
): ClaudeAccountWorktreeUsageReport {
  return { ...emptyClaudeAccountWorktreeUsageReport('account-a', true), ...overrides }
}

describe('describeClaudeAccountHolders', () => {
  it('names only the worktrees with a live terminal', () => {
    const holders = describeClaudeAccountHolders(
      report({
        worktrees: [
          { worktreeId: 'wt-1', displayName: 'Feature A', hasLiveTerminal: true },
          { worktreeId: 'wt-2', displayName: 'Feature B', hasLiveTerminal: false }
        ]
      })
    )
    expect(holders).toEqual({
      kind: 'held',
      worktreeNames: ['Feature A'],
      otherAccountCount: 0,
      waitingOnLaunch: false
    })
  })

  it('falls back to the worktree id when it carries no display name', () => {
    const holders = describeClaudeAccountHolders(
      report({ worktrees: [{ worktreeId: 'wt-1', displayName: '', hasLiveTerminal: true }] })
    )
    expect(holders).toMatchObject({ kind: 'held', worktreeNames: ['wt-1'] })
  })

  // Why its own case: an unreported holder and no holder both arrive as empty
  // arrays, and collapsing them tells the user nothing is in the way while the
  // switch keeps failing.
  it('reads an unsupported report as unknown, not as no holder', () => {
    expect(describeClaudeAccountHolders(report({ supported: false }))).toEqual({ kind: 'unknown' })
    expect(describeClaudeAccountHolders(null)).toEqual({ kind: 'unknown' })
  })

  it('reads a supported empty report as no holder', () => {
    expect(describeClaudeAccountHolders(report())).toEqual({ kind: 'none' })
  })

  it('counts blocking accounts once each and reports a pending launch', () => {
    const holders = describeClaudeAccountHolders(
      report({
        pendingGlobalLaunchCount: 1,
        blockedByOtherAccounts: [
          { ptyId: 'p1', accountId: 'account-b', worktreeId: null, displayName: null },
          { ptyId: 'p2', accountId: 'account-b', worktreeId: null, displayName: null },
          { ptyId: 'p3', accountId: 'account-c', worktreeId: null, displayName: null }
        ]
      })
    )
    expect(holders).toEqual({
      kind: 'held',
      worktreeNames: [],
      otherAccountCount: 2,
      waitingOnLaunch: true
    })
  })
})

describe('claudeAccountHoldersMessage', () => {
  it('adds nothing when nothing holds the account', () => {
    expect(claudeAccountHoldersMessage({ kind: 'none' })).toBeNull()
  })

  it('says the holder is unknown rather than absent', () => {
    expect(claudeAccountHoldersMessage({ kind: 'unknown' })).toBe(
      'The host did not report which worktree holds it.'
    )
  })

  it('names the worktrees and how to clear them', () => {
    expect(
      claudeAccountHoldersMessage({
        kind: 'held',
        worktreeNames: ['Feature A', 'Feature B'],
        otherAccountCount: 0,
        waitingOnLaunch: false
      })
    ).toBe('Running Claude in Feature A, Feature B. Close it on the desktop, then try again.')
  })

  it('tells the user to wait when only a launch holds it', () => {
    expect(
      claudeAccountHoldersMessage({
        kind: 'held',
        worktreeNames: [],
        otherAccountCount: 0,
        waitingOnLaunch: true
      })
    ).toContain('A launch is still starting')
  })

  it('pluralizes the blocking accounts', () => {
    expect(
      claudeAccountHoldersMessage({
        kind: 'held',
        worktreeNames: [],
        otherAccountCount: 1,
        waitingOnLaunch: false
      })
    ).toContain('Another account has a live terminal')
    expect(
      claudeAccountHoldersMessage({
        kind: 'held',
        worktreeNames: [],
        otherAccountCount: 3,
        waitingOnLaunch: false
      })
    ).toContain('3 other accounts have live terminals')
  })
})
