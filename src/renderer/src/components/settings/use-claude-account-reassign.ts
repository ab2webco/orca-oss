import { useCallback, useEffect, useState } from 'react'
import type { ClaudeRateLimitAccountsState, GlobalSettings } from '../../../../shared/types'
import {
  emptyClaudeAccountWorktreeUsageReport,
  type ClaudeAccountWorktreeUsageReport
} from '../../../../shared/claude-account-worktree-usage'
import {
  getClaudeAccountWorktreeUsage,
  reassignClaudeWorktreeAccounts,
  removeClaudeProviderAccount
} from '@/runtime/runtime-provider-accounts-client'
import type { ProviderAccountRuntimeView } from './provider-account-visibility'
import type { ClaudeAccountReassignConfirmation } from './ClaudeAccountReassignDialog'

type ReassignSettings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>

export type ClaudeAccountReassignTarget = {
  accountId: string
  /** `remove` deletes the account once its worktrees move; `unblock` only moves
   *  them and then replays the operation the live-PTY gate refused. */
  mode: 'remove' | 'unblock'
  runtime: ProviderAccountRuntimeView
  retry: (() => Promise<ClaudeRateLimitAccountsState>) | null
}

export type ClaudeAccountReassignController = {
  target: ClaudeAccountReassignTarget | null
  /** null while the usage report is still loading. */
  report: ClaudeAccountWorktreeUsageReport | null
  destination: string | null
  setDestination: (accountId: string | null) => void
  open: (target: ClaudeAccountReassignTarget) => void
  close: () => void
  confirm: (confirmation: ClaudeAccountReassignConfirmation) => void
}

type UseClaudeAccountReassignOptions = {
  settings: ReassignSettings | null | undefined
  /** AccountsPane's shared action runner: owns loading state, roster sync, and toasts. */
  runAction: (
    action: `remove:${string}` | `reassign:${string}`,
    operation: () => Promise<ClaudeRateLimitAccountsState>,
    runtime: ProviderAccountRuntimeView
  ) => Promise<void>
}

/**
 * Drives the reassign dialog: loads which worktrees hold a Claude account, then
 * moves those pins (closing the terminals that block) and finishes the operation
 * the user originally asked for.
 */
export function useClaudeAccountReassign({
  settings,
  runAction
}: UseClaudeAccountReassignOptions): ClaudeAccountReassignController {
  const [target, setTarget] = useState<ClaudeAccountReassignTarget | null>(null)
  const [report, setReport] = useState<ClaudeAccountWorktreeUsageReport | null>(null)
  const [destination, setDestination] = useState<string | null>(null)

  useEffect(() => {
    if (!target) {
      setReport(null)
      return
    }
    let cancelled = false
    setReport(null)
    void getClaudeAccountWorktreeUsage(settings, target.accountId)
      .then((next) => {
        if (!cancelled) {
          setReport(next)
        }
      })
      .catch(() => {
        // Why: a failed probe must not strand the dialog on a spinner; fall back
        // to an empty report so the user can still pick a destination and retry.
        if (!cancelled) {
          setReport(emptyClaudeAccountWorktreeUsageReport(target.accountId))
        }
      })
    return () => {
      cancelled = true
    }
  }, [settings, target])

  const open = useCallback((next: ClaudeAccountReassignTarget) => {
    setDestination(null)
    setTarget(next)
  }, [])

  const close = useCallback(() => {
    setTarget(null)
  }, [])

  const confirm = useCallback(
    (confirmation: ClaudeAccountReassignConfirmation) => {
      if (!target) {
        return
      }
      const { accountId, mode, runtime, retry } = target
      setTarget(null)
      const closeOptions = {
        closeLiveTerminals: confirmation.closeLiveTerminals,
        closeLiveTerminalAccountIds: confirmation.closeLiveTerminalAccountIds
      }
      void runAction(
        mode === 'remove' ? `remove:${accountId}` : `reassign:${accountId}`,
        async () => {
          if (mode === 'remove') {
            // Why: removal already reassigns pins inside its durable commit, so
            // asking it to land them keeps both writes on one crash boundary.
            return removeClaudeProviderAccount(settings, accountId, {
              ...closeOptions,
              reassignPinnedTo: confirmation.toAccountId
            })
          }
          const reassigned = await reassignClaudeWorktreeAccounts(settings, {
            fromAccountId: accountId,
            toAccountId: confirmation.toAccountId,
            ...closeOptions
          })
          return retry ? retry() : reassigned
        },
        runtime
      )
    },
    [runAction, settings, target]
  )

  return { target, report, destination, setDestination, open, close, confirm }
}
