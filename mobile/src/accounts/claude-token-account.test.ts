import { describe, expect, it } from 'vitest'
import type { AccountsSnapshot, ClaudeAccountSummary } from '../components/accounts-snapshot'
import { claudeTokenAccountStatusOf } from './claude-token-account'

const DAY = 86_400_000
const SAVED = Date.UTC(2026, 10, 15)
const NOW = SAVED + 10 * DAY

const account = (over: Partial<ClaudeAccountSummary> = {}): ClaudeAccountSummary =>
  ({
    id: 'a-1',
    email: 'maya@acme.dev',
    longLivedTokenSetAt: SAVED,
    ...over
  }) as ClaudeAccountSummary

const limits = (verdicts?: unknown[]): AccountsSnapshot['rateLimits'] =>
  ({
    claude: null,
    codex: null,
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: [],
    ...(verdicts ? { claudeAccountAuth: verdicts } : {})
  }) as unknown as AccountsSnapshot['rateLimits']

const verdict = (over: Record<string, unknown>) => ({
  accountId: 'a-1',
  state: 'authenticated',
  checkedAt: NOW - 60_000,
  failure: null,
  undecided: null,
  undecidedAt: null,
  checking: false,
  ...over
})

describe('claudeTokenAccountStatusOf', () => {
  it('reads an account without a saved token as a plain login (older host sends none)', () => {
    expect(claudeTokenAccountStatusOf(account({ longLivedTokenSetAt: null }), limits(), NOW)).toBe(
      null
    )
    expect(
      claudeTokenAccountStatusOf(account({ longLivedTokenSetAt: undefined }), limits(), NOW)
    ).toBe(null)
  })

  it('leaves a custom endpoint account alone, as the desktop does', () => {
    expect(
      claudeTokenAccountStatusOf(account({ authMethod: 'custom-endpoint' }), limits(), NOW)
    ).toBe(null)
  })

  it("says launches use the token, with the desktop's saved and expiry dates", () => {
    expect(claudeTokenAccountStatusOf(account(), limits(), NOW)).toEqual({
      check: 'Launches on the token',
      tone: 'neutral',
      term: { expiry: 'Expires about Nov 15, 2027', saved: 'Saved Nov 15, 2026', soon: false }
    })
  })

  it("reads the token's own check, not the stored login", () => {
    const of = (token: unknown, state = 'failed') =>
      claudeTokenAccountStatusOf(account(), limits([verdict({ state, token })]), NOW)

    expect(of({ state: 'verified', checkedAt: NOW - 2 * 3_600_000 })).toMatchObject({
      check: 'Token verified 2h ago',
      tone: 'positive'
    })
    expect(of({ state: 'verified', checkedAt: NOW - 1_000 })?.check).toBe('Token verified just now')
    expect(of({ state: 'rejected', checkedAt: NOW })).toMatchObject({
      check: 'Token rejected — run claude setup-token again',
      tone: 'negative'
    })
    expect(of({ state: 'undecided', checkedAt: NOW })).toMatchObject({
      check: 'Token check inconclusive',
      tone: 'neutral'
    })
  })

  // Why: a token outranks the stored login, so its failure must not read as "sign in again" (ORCA-1039).
  it('keeps a failed stored login from turning the row red', () => {
    const status = claudeTokenAccountStatusOf(
      account(),
      limits([verdict({ state: 'failed', failure: 'credential-rejected' })]),
      NOW
    )

    expect(status).toMatchObject({ check: 'Launches on the token', tone: 'neutral' })
  })

  it('takes a verified stored login as the tone until the token is checked', () => {
    expect(claudeTokenAccountStatusOf(account(), limits([verdict({})]), NOW)?.tone).toBe('positive')
  })

  it('warns from 30 days before the one-year term ends, then says it expired', () => {
    const soon = claudeTokenAccountStatusOf(account(), limits(), SAVED + 340 * DAY)
    const past = claudeTokenAccountStatusOf(account(), limits(), SAVED + 400 * DAY)

    expect(soon?.term).toMatchObject({ soon: true })
    expect(past?.term).toMatchObject({ expiry: 'Expired about Nov 15, 2027', soon: true })
  })

  it('ignores a verdict shape it does not know instead of dropping the token mark', () => {
    const status = claudeTokenAccountStatusOf(account(), limits(['junk', { accountId: 7 }]), NOW)

    expect(status?.check).toBe('Launches on the token')
  })
})
