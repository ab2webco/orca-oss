import { describe, expect, it } from 'vitest'
import { requiresLiveClaudePtyReattach } from './live-claude-pty-reattach-requirement'

describe('requiresLiveClaudePtyReattach', () => {
  it('requires reattach for a surviving account-directed (injected) session', () => {
    expect(
      requiresLiveClaudePtyReattach({
        isExistingSharedClaudeSession: false,
        existingInjectedAccountId: 'acct_worker'
      })
    ).toBe(true)
  })

  it('keeps requiring reattach for a surviving shared session', () => {
    expect(
      requiresLiveClaudePtyReattach({
        isExistingSharedClaudeSession: true,
        existingInjectedAccountId: null
      })
    ).toBe(true)
  })

  // Why: the reconciled-away case is exactly cold restore; forcing reattach there
  // would turn every restored agent pane into a spawn failure.
  it('does not require reattach once no daemon hosts the session', () => {
    expect(
      requiresLiveClaudePtyReattach({
        isExistingSharedClaudeSession: false,
        existingInjectedAccountId: null
      })
    ).toBe(false)
  })
})
