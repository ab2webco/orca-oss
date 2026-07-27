import { describe, expect, it } from 'vitest'
import {
  classifyClaudeAccountBlock,
  planClaudeAccountReassignment
} from './claude-account-reassign-plan'
import type { ClaudeAccountWorktreeUsageReport } from '../../../../shared/claude-account-worktree-usage'

function report(
  overrides: Partial<ClaudeAccountWorktreeUsageReport> = {}
): ClaudeAccountWorktreeUsageReport {
  return {
    accountId: 'account-a',
    worktrees: [],
    liveTerminalCount: 0,
    pendingLaunchCount: 0,
    pendingGlobalLaunchCount: 0,
    blockedByOtherAccounts: [],
    supported: true,
    ...overrides
  }
}

describe('classifyClaudeAccountBlock', () => {
  it('treats the live-PTY gate refusals as resolvable in the dialog', () => {
    expect(
      classifyClaudeAccountBlock(
        'This Claude account is in use by an assigned worktree. Close its Claude terminal before changing the account.'
      )
    ).toBe('in-use')
    expect(
      classifyClaudeAccountBlock(
        'This Claude account is already in use by a global terminal. Close it before launching the assigned account.'
      )
    ).toBe('in-use')
  })

  it('treats an in-flight launch as something only waiting clears', () => {
    expect(
      classifyClaudeAccountBlock(
        'A global Claude terminal launch is still starting. Try again when the launch finishes.'
      )
    ).toBe('launching')
    expect(
      classifyClaudeAccountBlock('This Claude account is being launched globally. Try again when it finishes.')
    ).toBe('launching')
  })

  it('leaves unrelated failures to the ordinary error toast', () => {
    expect(classifyClaudeAccountBlock('Claude sign-in failed. Please try again.')).toBeNull()
  })
})

describe('planClaudeAccountReassignment', () => {
  it('splits live worktrees from pin-only ones', () => {
    const plan = planClaudeAccountReassignment(
      report({
        worktrees: [
          { worktreeId: 'repo::a', displayName: 'a', hasLiveTerminal: true },
          { worktreeId: 'repo::b', displayName: 'b', hasLiveTerminal: false }
        ],
        liveTerminalCount: 1
      })
    )

    expect(plan.liveWorktrees.map((w) => w.displayName)).toEqual(['a'])
    expect(plan.pinnedOnlyWorktrees.map((w) => w.displayName)).toEqual(['b'])
    expect(plan.closesTerminals).toBe(true)
  })

  it('collects the other accounts whose terminals must close too', () => {
    const plan = planClaudeAccountReassignment(
      report({
        blockedByOtherAccounts: [
          { ptyId: 'p1', accountId: 'account-b', worktreeId: 'repo::c', displayName: 'c' },
          { ptyId: 'p2', accountId: 'account-b', worktreeId: 'repo::d', displayName: 'd' }
        ]
      })
    )

    expect(plan.blockingAccountIds).toEqual(['account-b'])
    expect(plan.closesTerminals).toBe(true)
  })

  it('flags a pending launch that no force-close can clear', () => {
    expect(planClaudeAccountReassignment(report({ pendingLaunchCount: 1 })).waitingOnLaunch).toBe(
      true
    )
    expect(
      planClaudeAccountReassignment(report({ pendingGlobalLaunchCount: 1 })).waitingOnLaunch
    ).toBe(true)
    expect(planClaudeAccountReassignment(report()).waitingOnLaunch).toBe(false)
  })
})
