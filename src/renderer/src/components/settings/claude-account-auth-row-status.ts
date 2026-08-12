import type { ProviderRateLimits, RateLimitState } from '../../../../shared/rate-limit-types'
import type {
  ClaudeAccountAuthUndecided,
  ClaudeAccountAuthVerdict
} from '../../../../shared/claude-account-auth-verdict'

export type ClaudeAccountAuthRowTone = 'positive' | 'negative' | 'neutral'

export type ClaudeAccountAuthRowKind =
  | 'checking'
  | 'verified'
  | 'credential-rejected'
  | 'no-credentials'
  | 'unchecked'

export type ClaudeAccountAuthRowStatus = {
  tone: ClaudeAccountAuthRowTone
  kind: ClaudeAccountAuthRowKind
  checkedAt: number | null
  undecided: ClaudeAccountAuthUndecided | null
}

export function findClaudeAccountAuthVerdict(
  rateLimits: RateLimitState,
  accountId: string
): ClaudeAccountAuthVerdict | null {
  return rateLimits.claudeAccountAuth?.find((verdict) => verdict.accountId === accountId) ?? null
}

export function resolveClaudeAccountAuthRowStatus(
  verdict: ClaudeAccountAuthVerdict | null
): ClaudeAccountAuthRowStatus {
  if (verdict?.checking) {
    return { tone: 'neutral', kind: 'checking', checkedAt: verdict.checkedAt, undecided: null }
  }
  if (!verdict || verdict.state === 'unverified') {
    return {
      tone: 'neutral',
      kind: 'unchecked',
      checkedAt: null,
      undecided: verdict?.undecided ?? null
    }
  }
  if (verdict.state === 'failed') {
    return {
      tone: 'negative',
      kind: verdict.failure === 'no-credentials' ? 'no-credentials' : 'credential-rejected',
      checkedAt: verdict.checkedAt,
      undecided: verdict.undecided
    }
  }
  return {
    tone: 'positive',
    kind: 'verified',
    checkedAt: verdict.checkedAt,
    undecided: verdict.undecided
  }
}

export function selectClaudeAccountUsage(
  rateLimits: RateLimitState,
  accountId: string,
  isActive: boolean
): ProviderRateLimits | null {
  if (isActive) {
    return rateLimits.claude
  }
  return (
    rateLimits.inactiveClaudeAccounts.find((entry) => entry.accountId === accountId)?.rateLimits ??
    null
  )
}
