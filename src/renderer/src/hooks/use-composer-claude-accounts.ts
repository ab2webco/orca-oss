import { useEffect, useState } from 'react'
import type { ClaudeManagedAccountSummary } from '../../../shared/types'
import { useAppStore } from '@/store'
import { listClaudeAccountsForActiveHost } from '@/runtime/runtime-provider-account-roster'

export function useComposerClaudeAccounts(enabled: boolean): ClaudeManagedAccountSummary[] {
  const activeRuntimeEnvironmentId = useAppStore(
    (state) => state.settings?.activeRuntimeEnvironmentId ?? null
  )
  const [accounts, setAccounts] = useState<ClaudeManagedAccountSummary[]>([])

  useEffect(() => {
    if (!enabled) {
      setAccounts([])
      return
    }
    let cancelled = false
    // Why: account discovery can refresh provider state, so only pay for it
    // when the selected target can display and persist the account picker.
    // Why the routed roster: the picker pins an account onto a worktree that may
    // live on a server, and this preload call handed it the desktop's own list.
    void listClaudeAccountsForActiveHost({ activeRuntimeEnvironmentId })
      .then((result) => {
        if (!cancelled) {
          setAccounts(result.accounts)
        }
      })
      .catch(() => {
        // Non-fatal: an unavailable account service hides the optional picker.
      })
    return () => {
      cancelled = true
    }
  }, [enabled, activeRuntimeEnvironmentId])

  return accounts
}
