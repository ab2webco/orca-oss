import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

export type ClaudeProfileAccountIdentity = {
  profileName: string
  accountId: string
  email: string
  organizationUuid: string | null
}

// Why: a packaged install and a dev build sit side by side under one profiles root with separate
// settings stores, so the in-profile duplicate guard cannot see the same identity in the neighbour
// and both copies end up forking one single-use refresh chain (ORCA-496). Every read is
// best-effort per entry — an unreadable or half-written neighbour must not fail the add.
export function listClaudeIdentitiesInOtherProfiles(
  profilesRoot: string,
  currentProfilePath: string
): ClaudeProfileAccountIdentity[] {
  const currentProfile = canonicalPath(currentProfilePath)
  const identities: ClaudeProfileAccountIdentity[] = []
  for (const profileName of readDirectoryNames(profilesRoot)) {
    const profilePath = join(profilesRoot, profileName)
    // Why canonical and not by name: a profile reached through a symlink or junction is the same
    // store as the current one, and reporting it would block re-adding an account to itself.
    if (canonicalPath(profilePath) === currentProfile) {
      continue
    }
    const accountsRoot = join(profilePath, 'claude-accounts')
    for (const accountId of readDirectoryNames(accountsRoot)) {
      const identity = readVaultIdentity(join(accountsRoot, accountId, 'auth'), accountId)
      if (identity) {
        identities.push({ profileName, accountId, ...identity })
      }
    }
  }
  return identities
}

function readVaultIdentity(
  managedAuthPath: string,
  accountId: string
): { email: string; organizationUuid: string | null } | null {
  try {
    // Why the marker: the profiles root holds every app's data, so a same-shaped directory tree
    // proves nothing until it carries the ownership marker Orca writes into its own vaults.
    if (
      readFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'utf-8').trim() !== accountId
    ) {
      return null
    }
    const parsed = JSON.parse(
      readFileSync(join(managedAuthPath, 'oauth-account.json'), 'utf-8')
    ) as {
      emailAddress?: unknown
      organizationUuid?: unknown
    }
    if (typeof parsed.emailAddress !== 'string' || parsed.emailAddress.trim() === '') {
      return null
    }
    return {
      email: parsed.emailAddress,
      organizationUuid: typeof parsed.organizationUuid === 'string' ? parsed.organizationUuid : null
    }
  } catch {
    return null
  }
}

function readDirectoryNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
