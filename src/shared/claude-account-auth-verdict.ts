// When Orca verifies, why it never polls, and what each row state means:
// docs/reference/claude-account-auth-verdicts.md
import type { ProviderRateLimits, UsageRateLimitFailureKind } from './rate-limit-types'

export type ClaudeAccountAuthState = 'authenticated' | 'failed' | 'unverified'

export type ClaudeAccountAuthFailure = 'no-credentials' | 'credential-rejected'

export type ClaudeAccountAuthUndecided =
  | 'network'
  | 'server'
  | 'provider-throttled'
  | 'live-session-holds-token'
  | 'keychain-unavailable'
  | 'usage-unavailable'
  | 'unknown'

export type ClaudeAccountAuthVerdict = {
  accountId: string
  state: ClaudeAccountAuthState
  checkedAt: number | null
  failure: ClaudeAccountAuthFailure | null
  undecided: ClaudeAccountAuthUndecided | null
  undecidedAt: number | null
  checking: boolean
}

export type ClaudeAccountAuthProbe =
  | { outcome: 'authenticated'; at: number }
  | { outcome: 'failed'; at: number; failure: ClaudeAccountAuthFailure }
  | { outcome: 'undecided'; at: number; undecided: ClaudeAccountAuthUndecided }

const NO_CREDENTIALS_ERROR_RE = /^no credentials$/i

export function readClaudeAccountAuthProbe(
  limits: ProviderRateLimits,
  now: number
): ClaudeAccountAuthProbe {
  if (limits.status === 'ok') {
    return { outcome: 'authenticated', at: limits.updatedAt || now }
  }
  const failureKind = limits.usageMetadata?.failureKind ?? null
  if (failureKind) {
    return readClaudeAccountAuthProbeFromFailureKind(failureKind, now)
  }
  if (limits.error && NO_CREDENTIALS_ERROR_RE.test(limits.error.trim())) {
    // Managed Keychain read failures currently collapse to this same legacy error.
    return { outcome: 'undecided', at: now, undecided: 'unknown' }
  }
  return { outcome: 'undecided', at: now, undecided: 'unknown' }
}

export function readClaudeAccountAuthProbeFromFailureKind(
  failureKind: UsageRateLimitFailureKind,
  now: number
): ClaudeAccountAuthProbe {
  switch (failureKind) {
    case 'missing-credentials':
      return { outcome: 'failed', at: now, failure: 'no-credentials' }
    case 'stale-token':
      return { outcome: 'failed', at: now, failure: 'credential-rejected' }
    case 'deferred-by-live-session':
      return { outcome: 'undecided', at: now, undecided: 'live-session-holds-token' }
    case 'keychain-unavailable':
      return { outcome: 'undecided', at: now, undecided: 'keychain-unavailable' }
    case 'network':
      return { outcome: 'undecided', at: now, undecided: 'network' }
    case 'server':
      return { outcome: 'undecided', at: now, undecided: 'server' }
    case 'rate-limited':
      return { outcome: 'undecided', at: now, undecided: 'provider-throttled' }
    case 'refreshable-credentials-without-token':
    case 'delegated-refresh-required':
    case 'missing-scope':
    case 'parse':
    case 'cli-unavailable':
    case 'usage-unavailable':
      return { outcome: 'undecided', at: now, undecided: 'usage-unavailable' }
    case 'unknown':
      return { outcome: 'undecided', at: now, undecided: 'unknown' }
  }
}

export function unverifiedClaudeAccountAuthVerdict(accountId: string): ClaudeAccountAuthVerdict {
  return {
    accountId,
    state: 'unverified',
    checkedAt: null,
    failure: null,
    undecided: null,
    undecidedAt: null,
    checking: false
  }
}

export function applyClaudeAccountAuthProbe(
  previous: ClaudeAccountAuthVerdict | null,
  accountId: string,
  probe: ClaudeAccountAuthProbe
): ClaudeAccountAuthVerdict {
  const base = previous ?? unverifiedClaudeAccountAuthVerdict(accountId)
  if (probe.outcome === 'undecided') {
    return { ...base, accountId, undecided: probe.undecided, undecidedAt: probe.at }
  }
  return {
    ...base,
    accountId,
    state: probe.outcome === 'authenticated' ? 'authenticated' : 'failed',
    checkedAt: probe.at,
    failure: probe.outcome === 'failed' ? probe.failure : null,
    undecided: null,
    undecidedAt: null
  }
}
