import { afterEach, describe, expect, it } from 'vitest'
import { requiresLiveClaudePtyReattach } from './live-claude-pty-reattach-requirement'
import {
  clearInjectedClaudePtyBinding,
  seedInjectedClaudePtyBindings
} from './injected-claude-pty-binding'
import { markClaudePtyExited, markClaudePtySpawned } from './live-pty-gate'

const SESSION_ID = 'repo1::/w/one@@0a1b2c3d'

afterEach(() => {
  markClaudePtyExited(SESSION_ID)
  clearInjectedClaudePtyBinding(SESSION_ID, null)
})

describe('requiresLiveClaudePtyReattach', () => {
  it('requires reattach for a surviving account-directed (injected) session', () => {
    seedInjectedClaudePtyBindings([{ sessionId: SESSION_ID, accountId: 'acct_worker' }])
    expect(requiresLiveClaudePtyReattach(SESSION_ID)).toBe(true)
  })

  it('keeps requiring reattach for a surviving shared session', () => {
    markClaudePtySpawned(SESSION_ID)
    expect(requiresLiveClaudePtyReattach(SESSION_ID)).toBe(true)
  })

  // Why: the reconciled-away case is exactly cold restore; forcing reattach there
  // would turn every restored agent pane into a spawn failure.
  it('does not require reattach once no daemon hosts the session', () => {
    expect(requiresLiveClaudePtyReattach(SESSION_ID)).toBe(false)
  })

  it('never requires reattach for a fresh create with no session id', () => {
    expect(requiresLiveClaudePtyReattach(undefined)).toBe(false)
  })
})
