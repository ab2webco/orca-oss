import { join } from 'node:path'
import {
  readActiveClaudeKeychainCredentialsStrict,
  readManagedClaudeKeychainCredentials
} from './keychain'
import {
  getClaudeManagedAccountsRoot,
  readClaudeManagedAuthFile,
  resolveOwnedClaudeManagedAuthPath
} from './managed-auth-path'

// Why: the Claude CLI wipes refreshToken to "" after a rejected refresh, and a login past
// refreshTokenExpiresAt cannot be renewed; both are readable offline, before a pane dies on them.
export type ClaudeStoredLoginEnd = 'wiped' | 'time-limit'

export type ClaudeStoredLogin = { ended: ClaudeStoredLoginEnd | null; endsAt: number | null }

const UNKNOWN_LOGIN: ClaudeStoredLogin = { ended: null, endsAt: null }

export function readClaudeStoredLogin(credentialsJson: string, now: number): ClaudeStoredLogin {
  let oauth: Record<string, unknown> | null = null
  try {
    const blob = (JSON.parse(credentialsJson) as { claudeAiOauth?: unknown })?.claudeAiOauth
    oauth =
      blob && typeof blob === 'object' && !Array.isArray(blob)
        ? (blob as Record<string, unknown>)
        : null
  } catch {
    return UNKNOWN_LOGIN
  }
  if (!oauth) {
    return UNKNOWN_LOGIN
  }
  const limit = oauth.refreshTokenExpiresAt
  const endsAt = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null
  if (oauth.refreshToken === '') {
    return { ended: 'wiped', endsAt }
  }
  return { ended: endsAt !== null && endsAt <= now ? 'time-limit' : null, endsAt }
}

/** Ended only when every stored copy is: a launch seeds from whichever copy still works. */
export function claudeStoredLoginOf(
  copies: readonly (string | null)[],
  now: number
): ClaudeStoredLogin {
  const logins = copies
    .filter((copy): copy is string => typeof copy === 'string' && copy !== '')
    .map((copy) => readClaudeStoredLogin(copy, now))
  // Why: a wipe keeps refreshTokenExpiresAt, so a copy sharing it is an older link of the
  // same dead grant; a re-login mints a new grant with a new end.
  const deadGrants = new Set(
    logins
      .filter((login) => login.ended === 'wiped' && login.endsAt !== null && login.endsAt > 1)
      .map((login) => login.endsAt)
  )
  const live = logins.filter((login) => login.ended === null && !deadGrants.has(login.endsAt))
  if (live.length > 0) {
    const ends = live.map((login) => login.endsAt)
    // Why: a live copy without the field (older CLI) gives no end date to warn about.
    return { ended: null, endsAt: ends.includes(null) ? null : Math.max(...(ends as number[])) }
  }
  if (logins.length === 0) {
    return UNKNOWN_LOGIN
  }
  return {
    ended: logins.some((login) => login.ended === 'time-limit') ? 'time-limit' : 'wiped',
    endsAt: null
  }
}

/** Anthropic sign-ins only: custom endpoints have no stored OAuth login. */
export type StoredLoginAccount = { id: string; managedAuthRuntime?: 'host' | 'wsl' }

export async function readManagedClaudeStoredCopies(
  account: StoredLoginAccount
): Promise<(string | null)[]> {
  const candidatePath = join(getClaudeManagedAccountsRoot(), account.id, 'auth')
  const managedAuthPath = resolveOwnedClaudeManagedAuthPath(account.id, candidatePath)
  if (!managedAuthPath) {
    return []
  }
  if (process.platform === 'darwin') {
    // Why both: the pinned CLI rotates (and wipes) its config-dir item, while re-auth writes the managed item.
    return Promise.all([
      readActiveClaudeKeychainCredentialsStrict(managedAuthPath).catch(() => null),
      readManagedClaudeKeychainCredentials(account.id).catch(() => null)
    ])
  }
  return [readClaudeManagedAuthFile(managedAuthPath, '.credentials.json')]
}

// Why: a snapshot is read on every game launch and panel refresh; each keychain read spawns `security`.
const STORED_LOGIN_RECHECK_MS = 30_000
const lastCheckedAt = new Map<string, number>()

export type ReportEndedClaudeLoginsArgs = {
  accounts: readonly StoredLoginAccount[]
  alreadyFailed: (accountId: string) => boolean
  recordEnded: (accountId: string) => void
  recordEndsAt: (accountId: string, endsAt: number | null) => void
  readCopies?: (account: StoredLoginAccount) => Promise<(string | null)[]>
  now?: () => number
}

/** Records a failed verdict for each managed host login the CLI already ended. Never calls the provider. */
export async function reportEndedClaudeLogins(args: ReportEndedClaudeLoginsArgs): Promise<void> {
  const now = args.now ?? Date.now
  const readCopies = args.readCopies ?? readManagedClaudeStoredCopies
  const due = args.accounts.filter((account) => {
    if (account.managedAuthRuntime === 'wsl' || args.alreadyFailed(account.id)) {
      return false
    }
    const last = lastCheckedAt.get(account.id)
    return last === undefined || now() - last >= STORED_LOGIN_RECHECK_MS
  })
  await Promise.all(
    due.map(async (account) => {
      lastCheckedAt.set(account.id, now())
      let copies: (string | null)[]
      try {
        copies = await readCopies(account)
      } catch {
        return
      }
      const login = claudeStoredLoginOf(copies, now())
      args.recordEndsAt(account.id, login.endsAt)
      if (login.ended !== null) {
        args.recordEnded(account.id)
      }
    })
  )
}

export function resetStoredClaudeLoginChecksForTests(): void {
  lastCheckedAt.clear()
}
