import { describe, expect, it } from 'vitest'
import type { AccountListEntry } from './managed-account-list-entries'
import {
  claudeLoginEndNoticeOf,
  claudeSignInBlocksLaunch,
  failedSignInRefusalOf
} from './claude-login-end-notice'
import { isAutoPickableAccount } from './orchestrator-game-account-usage'

const NOW = Date.UTC(2026, 10, 6)

function entry(overrides: Partial<AccountListEntry> = {}): AccountListEntry {
  return {
    provider: 'claude',
    id: 'acct-1',
    email: 'a@example.com',
    active: false,
    runtime: 'host',
    wslDistro: null,
    authMethod: 'subscription-oauth',
    quota: null,
    auth: {
      accountId: 'acct-1',
      state: 'failed',
      checkedAt: NOW,
      failure: 'credential-rejected',
      undecided: null,
      undecidedAt: null,
      checking: false,
      loginEndsAt: NOW + 60 * 60 * 1000
    },
    ...overrides
  }
}

// ORCA-1039: launches on a vault holding a setup-token never use the stored login.
describe('a Claude account with a long-lived token', () => {
  it('is launchable, auto-pickable and not refused when its stored login failed', () => {
    const tokened = entry({ longLivedToken: true })
    expect(claudeSignInBlocksLaunch(tokened)).toBe(false)
    expect(failedSignInRefusalOf(tokened)).toBeNull()
    expect(isAutoPickableAccount(tokened)).toBe(true)
  })

  it('gets no login-end warning, since the token does not depend on that login', () => {
    expect(claudeLoginEndNoticeOf(entry({ longLivedToken: true }), NOW)).toBeNull()
  })

  it('leaves a failed account without a token blocked and warned', () => {
    const plain = entry()
    expect(claudeSignInBlocksLaunch(plain)).toBe(true)
    expect(failedSignInRefusalOf(plain)).toMatch(/sign-in failed/)
    expect(isAutoPickableAccount(plain)).toBe(false)
    expect(claudeLoginEndNoticeOf(plain, NOW)).toMatch(/ends in/)
  })

  it('does not change Codex accounts', () => {
    const codex = entry({ provider: 'codex', longLivedToken: true })
    expect(isAutoPickableAccount(codex)).toBe(false)
  })
})
