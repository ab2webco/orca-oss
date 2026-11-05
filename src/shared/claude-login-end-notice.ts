import type { AccountListEntry } from './managed-account-list-entries'

/** The CLI warns from 10 days out; a member launched inside this window can die mid-work. */
export const CLAUDE_LOGIN_END_WARNING_MS = 3 * 24 * 60 * 60 * 1000

const HOUR_MS = 60 * 60 * 1000

/** Why a named account must not take a member, or null when its sign-in has not failed. */
export function failedSignInRefusalOf(entry: AccountListEntry): string | null {
  if (entry.provider !== 'claude' || entry.auth?.state !== 'failed') {
    return null
  }
  return `${entry.email}'s sign-in failed on this host; a member launched on it would stop at \`Not logged in\`. Re-authenticate it in Settings → Accounts, or name another account. See \`orca game accounts\`.`
}

/** A warning when the login ends soon: renewing it does not move that date. */
export function claudeLoginEndNoticeOf(entry: AccountListEntry, now: number): string | null {
  const endsAt = entry.auth?.loginEndsAt
  if (entry.provider !== 'claude' || typeof endsAt !== 'number' || endsAt <= now) {
    return null
  }
  if (endsAt - now >= CLAUDE_LOGIN_END_WARNING_MS) {
    return null
  }
  const hours = Math.max(1, Math.floor((endsAt - now) / HOUR_MS))
  const left = hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} days`
  return `${entry.email}'s sign-in ends in ${left} (${new Date(endsAt).toISOString()}) and cannot be renewed; re-authenticate it in Settings → Accounts before then.`
}
