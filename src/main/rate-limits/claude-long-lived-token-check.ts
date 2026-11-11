import { net } from 'electron'
import type { ClaudeLongLivedTokenCheck } from '../../shared/claude-account-auth-verdict'
import { readLongLivedTokenFromVaultSettings } from '../claude-accounts/claude-long-lived-token'
import {
  readClaudeManagedAuthFile,
  resolveOwnedClaudeManagedAuthPath
} from '../claude-accounts/managed-auth-path'
import type { InactiveClaudeAccountInfo } from './claude-fetcher'

// Why the models list: it costs no tokens and answers 200 to a valid token, 401 to a bad one
// (probed ORCA-1160); the usage endpoint answers 429 either way and proves nothing.
const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1'
const TIMEOUT_MS = 10_000

type TokenFetch = (url: string, init: RequestInit) => Promise<{ status: number }>

export async function checkClaudeLongLivedToken(
  token: string,
  options: { fetchImpl?: TokenFetch; now?: () => number } = {}
): Promise<ClaudeLongLivedTokenCheck> {
  const fetchImpl = options.fetchImpl ?? ((url, init) => net.fetch(url, init))
  const now = options.now ?? Date.now
  let state: ClaudeLongLivedTokenCheck['state']
  try {
    const { status } = await fetchImpl(MODELS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    state =
      status >= 200 && status < 300
        ? 'verified'
        : status === 401 || status === 403
          ? 'rejected'
          : 'undecided'
  } catch {
    state = 'undecided'
  }
  return { state, checkedAt: now() }
}

/** Null when the account keeps no token in its vault, so there is nothing to check. */
export async function checkManagedClaudeLongLivedToken(
  account: InactiveClaudeAccountInfo
): Promise<ClaudeLongLivedTokenCheck | null> {
  if (account.managedAuthRuntime === 'wsl') {
    return null
  }
  const owned = resolveOwnedClaudeManagedAuthPath(account.id, account.managedAuthPath)
  const token = owned
    ? readLongLivedTokenFromVaultSettings(readClaudeManagedAuthFile(owned, 'settings.json'))
    : null
  return token ? checkClaudeLongLivedToken(token) : null
}
