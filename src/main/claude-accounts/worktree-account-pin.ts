import type { GlobalSettings } from '../../shared/types'

type ClaudeAccountPinStore = {
  getSettings(): Pick<GlobalSettings, 'claudeManagedAccounts'>
}

export function isManagedClaudeAccountId(store: ClaudeAccountPinStore, accountId: string): boolean {
  return store.getSettings().claudeManagedAccounts.some((account) => account.id === accountId)
}

export function normalizeClaudeAccountPinForCreate(
  store: ClaudeAccountPinStore,
  accountId: string | null | undefined
): string | null | undefined {
  if (typeof accountId !== 'string' || isManagedClaudeAccountId(store, accountId)) {
    return accountId
  }
  // Why: a slow worktree create may finish after its selected account was
  // removed; inherit global auth instead of durably resurrecting a dead pin.
  return null
}

export function assertValidClaudeAccountPin(
  store: ClaudeAccountPinStore,
  accountId: string | null | undefined
): void {
  if (typeof accountId === 'string' && !isManagedClaudeAccountId(store, accountId)) {
    throw new Error('That Claude account no longer exists.')
  }
}
