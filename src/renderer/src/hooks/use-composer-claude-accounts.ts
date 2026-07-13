import { useEffect, useState } from 'react'
import type { ClaudeManagedAccountSummary } from '../../../shared/types'

export function useComposerClaudeAccounts(enabled: boolean): ClaudeManagedAccountSummary[] {
  const [accounts, setAccounts] = useState<ClaudeManagedAccountSummary[]>([])

  useEffect(() => {
    if (!enabled) {
      setAccounts([])
      return
    }
    let cancelled = false
    // Why: account discovery can refresh provider state, so only pay for it
    // when the selected target can display and persist the account picker.
    void window.api.claudeAccounts
      .list()
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
  }, [enabled])

  return accounts
}
