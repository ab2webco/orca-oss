import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import { readLongLivedTokenFromVaultSettings } from './claude-long-lived-token'
import { readClaudeManagedAuthFile, resolveOwnedClaudeManagedAuthPath } from './managed-auth-path'

const MAX_LABEL_LENGTH = 200

/** A token-only account's display identity (ORCA-1215): the token cannot read the profile. */
export function normalizeTokenAccountLabel(raw: string): string {
  const label = raw.trim()
  if (!label) {
    throw new Error('Enter a name or email for the account.')
  }
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what is rejected
  if (label.length > MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error('Use a shorter name or email for the account, on one line.')
  }
  return label
}

/** Custom endpoint labels are free-form, not Claude identities, so they never collide. */
export function findClaudeAccountNamed(
  accounts: readonly ClaudeManagedAccount[],
  label: string
): ClaudeManagedAccount | null {
  const wanted = label.trim().toLowerCase()
  return (
    accounts.find(
      (account) =>
        account.authMethod !== 'custom-endpoint' && account.email.trim().toLowerCase() === wanted
    ) ?? null
  )
}

// Why compare tokens: two rows on one token are one account that would read as two.
export function findAccountStoringLongLivedToken(
  accounts: readonly ClaudeManagedAccount[],
  token: string
): ClaudeManagedAccount | null {
  for (const account of accounts) {
    if ((account.managedAuthRuntime ?? 'host') !== 'host') {
      continue
    }
    const owned = resolveOwnedClaudeManagedAuthPath(account.id, account.managedAuthPath)
    const stored = owned
      ? readLongLivedTokenFromVaultSettings(readClaudeManagedAuthFile(owned, 'settings.json'))
      : null
    if (stored === token) {
      return account
    }
  }
  return null
}
