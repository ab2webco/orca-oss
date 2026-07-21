import type { CodexManagedAccount, GlobalSettings } from '../../shared/types'
import {
  getWslSelectionKey,
  normalizeCodexAccountSelectionTarget,
  type CodexAccountSelectionTarget
} from './runtime-selection'

export const WORKTREE_CODEX_ACCOUNT_UNAVAILABLE_MESSAGE =
  'The Codex account assigned to this worktree is unavailable for this runtime. Reassign the account before launching Codex.'

export type WorktreeCodexAccountPinResolution =
  | { status: 'unpinned' }
  | { status: 'pinned'; account: CodexManagedAccount; codexHomePath: string }
  | { status: 'unavailable' }

/**
 * Resolves a per-worktree Codex account pin against the launch runtime. A host
 * launch only honors a host account; a WSL launch only honors a WSL account
 * whose distro matches (callers resolve a distro-less WSL launch to the
 * concrete default distro first). A dangling or runtime-incompatible pin is
 * `unavailable` so launch preparation can fail closed instead of silently
 * substituting the global selection.
 */
export function resolveWorktreeCodexAccountPin(args: {
  pinnedAccountId: string | null | undefined
  accounts: readonly CodexManagedAccount[]
  target: CodexAccountSelectionTarget | null | undefined
}): WorktreeCodexAccountPinResolution {
  if (typeof args.pinnedAccountId !== 'string' || args.pinnedAccountId.length === 0) {
    return { status: 'unpinned' }
  }
  const account = args.accounts.find((entry) => entry.id === args.pinnedAccountId)
  if (!account) {
    return { status: 'unavailable' }
  }
  const target = normalizeCodexAccountSelectionTarget(args.target)
  const accountIsWsl = account.managedHomeRuntime === 'wsl'
  if (target.runtime === 'host') {
    return accountIsWsl
      ? { status: 'unavailable' }
      : { status: 'pinned', account, codexHomePath: account.managedHomePath }
  }
  if (
    !accountIsWsl ||
    getWslSelectionKey(account.wslDistro) !== getWslSelectionKey(target.wslDistro)
  ) {
    return { status: 'unavailable' }
  }
  return { status: 'pinned', account, codexHomePath: account.managedHomePath }
}

type CodexAccountPinStore = {
  getSettings(): Pick<GlobalSettings, 'codexManagedAccounts'>
}

export function isManagedCodexAccountId(store: CodexAccountPinStore, accountId: string): boolean {
  return store.getSettings().codexManagedAccounts.some((account) => account.id === accountId)
}

export function assertValidCodexAccountPin(
  store: CodexAccountPinStore,
  accountId: string | null | undefined
): void {
  if (typeof accountId === 'string' && !isManagedCodexAccountId(store, accountId)) {
    throw new Error('That Codex account no longer exists.')
  }
}
