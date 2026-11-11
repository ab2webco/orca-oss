import { formatResetDuration } from '../../../../shared/rate-limit-reset-format'
import type { ClaudeLongLivedTokenCheck } from '../../../../shared/claude-account-auth-verdict'
import { i18n, translate } from '@/i18n/i18n'
import type { ClaudeAccountAuthRowStatus } from './claude-account-auth-row-status'

const DAY_MS = 86_400_000
// Why one year: `claude setup-token` mints "a one-year OAuth token"
// (https://code.claude.com/docs/en/authentication#generate-a-long-lived-token).
const TOKEN_LIFETIME_MS = 365 * DAY_MS
const EXPIRY_WARNING_MS = 30 * DAY_MS

function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(i18n.language || undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

function formatAgo(checkedAt: number, now: number): string {
  const elapsed = Math.max(0, now - checkedAt)
  return elapsed < 60_000
    ? translate('auto.components.settings.ClaudeAccountAuthStatusLine.justNow', 'just now')
    : translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.checkedAgo',
        '{{value0}} ago',
        { value0: formatResetDuration(elapsed) }
      )
}

/** The token row's lead: what the token's own check found, else that launches use it. */
export function describeTokenCheck(
  check: ClaudeLongLivedTokenCheck | undefined,
  now: number
): string {
  if (!check) {
    return translate(
      'auto.components.settings.ClaudeAccountAuthStatusLine.launchesOnToken',
      'Launches on the token'
    )
  }
  switch (check.state) {
    case 'verified':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.tokenVerifiedAt',
        'Token verified {{value0}}',
        {
          value0: formatAgo(check.checkedAt, now)
        }
      )
    case 'rejected':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.tokenRejected',
        'Token rejected — run claude setup-token again'
      )
    case 'undecided':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.tokenUndecided',
        'Token check inconclusive'
      )
  }
}

// Why "stored login": the token row's sign-in facts come from the vault login, not the token.
export function describeStoredLogin(status: ClaudeAccountAuthRowStatus, now: number): string {
  switch (status.kind) {
    case 'verified':
      return status.checkedAt === null
        ? translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.storedLoginVerified',
            'Stored login verified'
          )
        : translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.storedLoginVerifiedAt',
            'Stored login verified {{value0}}',
            {
              value0: formatAgo(status.checkedAt, now)
            }
          )
    case 'credential-rejected':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.storedLoginRejected',
        'Stored login expired'
      )
    case 'no-credentials':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.storedLoginMissing',
        'No stored login'
      )
    case 'checking':
    case 'unchecked':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.storedLoginUnchecked',
        'Stored login not checked'
      )
  }
}

/** The one-year term from the saved date; `soon` once 30 days or less remain. */
export function describeTokenTerm(
  savedAt: number | undefined,
  now: number
): { expiry: string; saved: string; soon: boolean } | null {
  if (!savedAt) {
    return null
  }
  const expiresAt = savedAt + TOKEN_LIFETIME_MS
  return {
    expiry:
      expiresAt <= now
        ? translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.tokenExpiredAbout',
            'Expired about {{value0}}',
            {
              value0: formatDay(expiresAt)
            }
          )
        : translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.tokenExpiresAbout',
            'Expires about {{value0}}',
            {
              value0: formatDay(expiresAt)
            }
          ),
    saved: translate(
      'auto.components.settings.ClaudeAccountAuthStatusLine.tokenSaved',
      'Saved {{value0}}',
      { value0: formatDay(savedAt) }
    ),
    soon: expiresAt - now <= EXPIRY_WARNING_MS
  }
}
