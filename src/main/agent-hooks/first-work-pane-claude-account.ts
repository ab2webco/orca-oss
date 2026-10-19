import type { ManagedPtyAccountOwner } from '../../shared/managed-account-types'

export type PaneClaudeAccountLookup = {
  getPtyIdForPaneKey: (paneKey: string) => string | null | undefined
  getManagedPtyAccountOwner: (ptyId: string, agent: 'claude') => ManagedPtyAccountOwner
}

/** Claude account the pane's live PTY runs on; null when absent, unknown, or the shared login. */
export function resolvePaneClaudeAccountId(
  paneKey: string,
  lookup: PaneClaudeAccountLookup
): string | null {
  const ptyId = lookup.getPtyIdForPaneKey(paneKey)
  if (!ptyId) {
    return null
  }
  // Why: an orchestration worker's PTY can run on an account the worktree pin never records.
  const owner = lookup.getManagedPtyAccountOwner(ptyId, 'claude')
  return owner.known ? owner.accountId : null
}
