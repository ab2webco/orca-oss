import { formatResetDuration } from '../../../src/shared/rate-limit-reset-format'
import type { AccountsSnapshot, ClaudeAccountSummary } from '../components/accounts-snapshot'

const DAY_MS = 86_400_000
// Why one year: `claude setup-token` mints "a one-year OAuth token" (desktop's token status text).
const TOKEN_LIFETIME_MS = 365 * DAY_MS
const EXPIRY_WARNING_MS = 30 * DAY_MS

export type ClaudeTokenTone = 'positive' | 'negative' | 'neutral'

/** A long-lived-token account's row, in the desktop's words (ClaudeAccountTokenStatusLine). */
export type ClaudeTokenAccountStatus = {
  check: string
  tone: ClaudeTokenTone
  term: { expiry: string; saved: string; soon: boolean }
}

type Verdict = { state: unknown; token: { state: unknown; checkedAt: number } | null }

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

function verdictOf(rateLimits: AccountsSnapshot['rateLimits'], accountId: string): Verdict | null {
  const list = (rateLimits as { claudeAccountAuth?: unknown }).claudeAccountAuth
  const found = (Array.isArray(list) ? list : [])
    .map(recordOf)
    .find((one) => one?.accountId === accountId)
  if (!found) {
    return null
  }
  const token = recordOf(found.token)
  return {
    state: found.state,
    token:
      token && typeof token.checkedAt === 'number'
        ? { state: token.state, checkedAt: token.checkedAt }
        : null
  }
}

const formatDay = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })

const formatAgo = (checkedAt: number, now: number): string => {
  const elapsed = Math.max(0, now - checkedAt)
  return elapsed < 60_000 ? 'just now' : `${formatResetDuration(elapsed)} ago`
}

function checkOf(
  verdict: Verdict | null,
  now: number
): Pick<ClaudeTokenAccountStatus, 'check' | 'tone'> {
  const token = verdict?.token
  switch (token?.state) {
    case 'verified':
      return { check: `Token verified ${formatAgo(token.checkedAt, now)}`, tone: 'positive' }
    case 'rejected':
      return { check: 'Token rejected — run claude setup-token again', tone: 'negative' }
    case 'undecided':
      return { check: 'Token check inconclusive', tone: 'neutral' }
  }
  // Why never negative: launches do not use the stored login, so its failure is no reason to sign in.
  return {
    check: 'Launches on the token',
    tone: verdict?.state === 'authenticated' ? 'positive' : 'neutral'
  }
}

/** null for an account that launches on its stored login, or an older host that sends no date. */
export function claudeTokenAccountStatusOf(
  account: ClaudeAccountSummary,
  rateLimits: AccountsSnapshot['rateLimits'],
  now: number
): ClaudeTokenAccountStatus | null {
  const savedAt = account.longLivedTokenSetAt
  if (!savedAt || account.authMethod === 'custom-endpoint') {
    return null
  }
  const expiresAt = savedAt + TOKEN_LIFETIME_MS
  return {
    ...checkOf(verdictOf(rateLimits, account.id), now),
    term: {
      expiry: `${expiresAt <= now ? 'Expired' : 'Expires'} about ${formatDay(expiresAt)}`,
      saved: `Saved ${formatDay(savedAt)}`,
      soon: expiresAt - now <= EXPIRY_WARNING_MS
    }
  }
}
