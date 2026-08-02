import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeManagedAccount } from '../../shared/types'
import { resolveOwnedClaudeManagedAuthPath } from './managed-auth-path'
import { readManagedClaudeKeychainCredentials } from './keychain'

/** Managed OAuth account authenticated in its own vault — never via the legacy machine keychain. */
export async function isManagedClaudeVaultAuthenticated(
  account: ClaudeManagedAccount
): Promise<boolean> {
  const root = resolveOwnedClaudeManagedAuthPath(account.id, account.managedAuthPath)
  if (!root) {
    return false
  }
  if (existsSync(join(root, '.credentials.json'))) {
    return true
  }
  // Why: macOS logins keep the token in an Orca-scoped Keychain item instead of
  // the vault file; reading it by account id is what excludes the machine-wide
  // legacy item that belongs to whichever identity logged in last.
  if (process.platform !== 'darwin') {
    return false
  }
  try {
    return (await readManagedClaudeKeychainCredentials(account.id)) !== null
  } catch {
    return false
  }
}
