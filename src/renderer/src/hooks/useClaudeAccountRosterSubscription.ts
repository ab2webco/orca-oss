import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { watchProviderAccounts } from '@/runtime/runtime-provider-accounts-client'

/**
 * Opens a single app-scoped watcher that mirrors the Claude account roster into
 * the store so sidebar rows can resolve their active account reactively. Re-keys
 * on the active runtime environment (local vs remote own different rosters); the
 * local path resolves once, the remote path streams usage refreshes.
 */
export function useClaudeAccountRosterSubscription(): void {
  const activeRuntimeEnvironmentId = useAppStore(
    (s) => s.settings?.activeRuntimeEnvironmentId?.trim() || null
  )
  const setClaudeAccountRoster = useAppStore((s) => s.setClaudeAccountRoster)

  useEffect(() => {
    const watcher = watchProviderAccounts(
      { activeRuntimeEnvironmentId },
      {
        onSnapshot: (snapshot) => {
          // Why: a failed Claude half is a substituted empty roster, not
          // authoritative data; keep the prior roster instead of blanking chips.
          if (!snapshot.failedProviders?.includes('claude')) {
            setClaudeAccountRoster(snapshot.claude)
          }
        },
        onError: (error) => {
          console.error('Failed to load Claude account roster for sidebar:', error)
        }
      }
    )
    return () => {
      watcher.close()
    }
  }, [activeRuntimeEnvironmentId, setClaudeAccountRoster])
}
