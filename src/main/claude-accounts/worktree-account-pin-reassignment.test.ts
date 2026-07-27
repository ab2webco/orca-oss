import { describe, expect, it } from 'vitest'
import { planClaudeWorktreePinReassignment } from './worktree-account-pin-reassignment'

const META = {
  'repo-1::/work/a': { claudeAccountId: 'account-a' },
  'repo-1::/work/b': { claudeAccountId: 'account-a' },
  'repo-2::/work/c': { claudeAccountId: 'account-a' },
  'repo-2::/work/d': { claudeAccountId: 'account-b' },
  'repo-2::/work/e': {}
}

describe('planClaudeWorktreePinReassignment', () => {
  it('moves every pin of the source account to the chosen destination', () => {
    const plan = planClaudeWorktreePinReassignment(META, 'account-a', 'account-b')

    expect(plan.worktreeIds).toEqual(['repo-1::/work/a', 'repo-1::/work/b', 'repo-2::/work/c'])
    expect(plan.pins).toEqual({
      'repo-1::/work/a': 'account-b',
      'repo-1::/work/b': 'account-b',
      'repo-2::/work/c': 'account-b'
    })
    expect(plan.repoIds).toEqual(['repo-1', 'repo-2'])
  })

  it('clears the pins when the destination is the system default', () => {
    const plan = planClaudeWorktreePinReassignment(META, 'account-a', null)

    expect(Object.values(plan.pins)).toEqual([null, null, null])
  })

  it('leaves other accounts and unpinned worktrees untouched', () => {
    const plan = planClaudeWorktreePinReassignment(META, 'account-a', null)

    expect(plan.worktreeIds).not.toContain('repo-2::/work/d')
    expect(plan.worktreeIds).not.toContain('repo-2::/work/e')
  })

  it('plans nothing when no worktree uses the account', () => {
    const plan = planClaudeWorktreePinReassignment(META, 'account-z', null)

    expect(plan).toEqual({ worktreeIds: [], pins: {}, repoIds: [] })
  })
})
