import { describe, expect, it } from 'vitest'
import { plainRowAccountOf } from './new-tab-plain-account'

// Why (ORCA-717): the plain row shows what today's launch resolves, and passes no id unless picked.
describe('plainRowAccountOf', () => {
  it('shows the worktree pin when the worktree is pinned', () => {
    expect(plainRowAccountOf({ worktreePinId: 'acct-pin', globalActiveId: 'acct-global' })).toEqual(
      {
        accountId: 'acct-pin',
        source: 'worktree-pin'
      }
    )
  })

  it('shows the global selection when the worktree has no pin', () => {
    expect(plainRowAccountOf({ worktreePinId: null, globalActiveId: 'acct-global' })).toEqual({
      accountId: 'acct-global',
      source: 'global'
    })
  })

  it('shows the shared home when neither is set', () => {
    expect(plainRowAccountOf({ worktreePinId: null, globalActiveId: null })).toEqual({
      accountId: null,
      source: 'shared-home'
    })
  })
})
