import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits, UsageRateLimitFailureKind } from './rate-limit-types'
import {
  applyClaudeAccountAuthProbe,
  readClaudeAccountAuthProbe,
  readClaudeAccountAuthProbeFromFailureKind,
  unverifiedClaudeAccountAuthVerdict
} from './claude-account-auth-verdict'

const NOW = 1_760_000_000_000

function limits(overrides: Partial<ProviderRateLimits>): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: NOW,
    error: null,
    status: 'ok',
    ...overrides
  }
}

describe('readClaudeAccountAuthProbe', () => {
  it('treats a completed usage read as proof the credential authenticates', () => {
    expect(
      readClaudeAccountAuthProbe(
        limits({
          status: 'ok',
          session: { usedPercent: 12, windowMinutes: 300, resetsAt: null, resetDescription: null }
        }),
        NOW
      )
    ).toEqual({ outcome: 'authenticated', at: NOW })
  })

  it('reports an OAuth-rejected credential as failed even after the CLI leg also failed', () => {
    expect(
      readClaudeAccountAuthProbe(
        limits({
          status: 'error',
          error: 'invalid',
          usageMetadata: { failureKind: 'stale-token' }
        }),
        NOW
      )
    ).toEqual({ outcome: 'failed', at: NOW, failure: 'credential-rejected' })
  })

  it('keeps a healthy account verified when OAuth 401s and the CLI fallback succeeds', () => {
    const finalRecord = limits({
      status: 'ok',
      usageMetadata: { source: 'cli', attemptedSources: ['oauth', 'cli'], failureKind: undefined },
      session: { usedPercent: 40, windowMinutes: 300, resetsAt: null, resetDescription: null }
    })
    expect(readClaudeAccountAuthProbe(finalRecord, NOW).outcome).toBe('authenticated')
  })

  it('reads a bare "No credentials" error as a missing credential', () => {
    expect(
      readClaudeAccountAuthProbe(limits({ status: 'error', error: 'No credentials' }), NOW)
    ).toEqual({ outcome: 'failed', at: NOW, failure: 'no-credentials' })
  })

  it('never blames the account for an unrecognized error', () => {
    expect(
      readClaudeAccountAuthProbe(limits({ status: 'error', error: 'something else' }), NOW).outcome
    ).toBe('undecided')
  })
})

describe('readClaudeAccountAuthProbeFromFailureKind', () => {
  const failed: UsageRateLimitFailureKind[] = ['missing-credentials', 'stale-token']
  const undecided: UsageRateLimitFailureKind[] = [
    'refreshable-credentials-without-token',
    'delegated-refresh-required',
    'deferred-by-live-session',
    'keychain-unavailable',
    'missing-scope',
    'network',
    'server',
    'parse',
    'rate-limited',
    'cli-unavailable',
    'usage-unavailable',
    'unknown'
  ]

  it.each(failed)('classifies %s as a failed credential', (kind) => {
    expect(readClaudeAccountAuthProbeFromFailureKind(kind, NOW).outcome).toBe('failed')
  })

  it.each(undecided)('leaves %s undecided', (kind) => {
    expect(readClaudeAccountAuthProbeFromFailureKind(kind, NOW).outcome).toBe('undecided')
  })

  it('names a pinned live session as the reason it could not check', () => {
    expect(readClaudeAccountAuthProbeFromFailureKind('deferred-by-live-session', NOW)).toEqual({
      outcome: 'undecided',
      at: NOW,
      undecided: 'live-session-holds-token'
    })
  })
})

describe('applyClaudeAccountAuthProbe', () => {
  it('starts unverified and records the first decisive check', () => {
    const verdict = applyClaudeAccountAuthProbe(null, 'acct_1', {
      outcome: 'authenticated',
      at: NOW
    })
    expect(verdict).toMatchObject({
      accountId: 'acct_1',
      state: 'authenticated',
      checkedAt: NOW,
      failure: null
    })
  })

  it('does not downgrade a verified account when a later check is undecided', () => {
    const verified = applyClaudeAccountAuthProbe(null, 'acct_1', {
      outcome: 'authenticated',
      at: NOW
    })
    const afterBlip = applyClaudeAccountAuthProbe(verified, 'acct_1', {
      outcome: 'undecided',
      at: NOW + 1000,
      undecided: 'network'
    })
    expect(afterBlip.state).toBe('authenticated')
    expect(afterBlip.checkedAt).toBe(NOW)
    expect(afterBlip.undecided).toBe('network')
    expect(afterBlip.undecidedAt).toBe(NOW + 1000)
  })

  it('does not promote a failed account when a later check is undecided', () => {
    const failed = applyClaudeAccountAuthProbe(null, 'acct_1', {
      outcome: 'failed',
      at: NOW,
      failure: 'credential-rejected'
    })
    const afterBlip = applyClaudeAccountAuthProbe(failed, 'acct_1', {
      outcome: 'undecided',
      at: NOW + 1000,
      undecided: 'live-session-holds-token'
    })
    expect(afterBlip.state).toBe('failed')
    expect(afterBlip.failure).toBe('credential-rejected')
  })

  it('clears the undecided marker once a check decides again', () => {
    const stale = {
      ...unverifiedClaudeAccountAuthVerdict('acct_1'),
      undecided: 'network' as const,
      undecidedAt: NOW
    }
    const recovered = applyClaudeAccountAuthProbe(stale, 'acct_1', {
      outcome: 'authenticated',
      at: NOW + 5000
    })
    expect(recovered.undecided).toBeNull()
    expect(recovered.undecidedAt).toBeNull()
  })
})
