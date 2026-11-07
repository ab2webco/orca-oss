import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import { fingerprintClaudeRefreshChain } from './claude-refresh-chain-fingerprint'

/** A managed write would give an account a refresh chain another account currently holds. */
export class ClaudeRefreshChainAliasError extends Error {
  constructor() {
    super('This Claude sign-in carries a refresh chain another saved account already holds.')
    this.name = 'ClaudeRefreshChainAliasError'
  }
}

/**
 * Throws when `credentialsJson`'s refresh chain is the current chain of a different managed
 * account. A single-use chain held by two accounts logs one out whenever the other refreshes
 * (ORCA-1039), so no write path may create that state, whatever produced the blob.
 */
export async function assertRefreshChainNotHeldByOtherAccount(
  accountId: string,
  credentialsJson: string,
  accounts: readonly ClaudeManagedAccount[],
  readCredentials: (account: ClaudeManagedAccount) => Promise<string | null>
): Promise<void> {
  const chain = fingerprintClaudeRefreshChain(credentialsJson)
  if (!chain) {
    return
  }
  for (const other of accounts) {
    if (other.id === accountId || other.authMethod === 'custom-endpoint') {
      continue
    }
    let otherCredentials: string | null
    try {
      otherCredentials = await readCredentials(other)
    } catch {
      continue
    }
    if (otherCredentials && fingerprintClaudeRefreshChain(otherCredentials) === chain) {
      throw new ClaudeRefreshChainAliasError()
    }
  }
}

/**
 * Whether an organization match can stand in for identity proof: only when no other managed
 * account belongs to that organization, since otherwise the blob may be that account's.
 */
export function organizationIdentifiesOneAccount(
  accountId: string,
  organizationUuid: string,
  accounts: readonly ClaudeManagedAccount[],
  readOrganizationUuid: (account: ClaudeManagedAccount) => string | null
): boolean {
  const normalized = organizationUuid.trim().toLowerCase()
  return !accounts.some(
    (other) =>
      other.id !== accountId &&
      other.authMethod !== 'custom-endpoint' &&
      readOrganizationUuid(other)?.trim().toLowerCase() === normalized
  )
}
