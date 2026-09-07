import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
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
import {
  reopenClaudeTerminalsAfterReauth,
  type ClaudeReauthReopenOutcome
} from '@/lib/claude-reauth-terminal-reopen'
import { translate } from '@/i18n/i18n'
import type { ProviderAccountRuntimeView } from './provider-account-visibility'
import type { ClaudeAccountReassignConfirmation } from './ClaudeAccountReassignDialog'
import { planClaudeAccountReassignment } from './claude-account-reassign-plan'

type ReassignSettings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>

export type ClaudeAccountReassignTarget = {
  accountId: string
  /** `remove` deletes the account once its worktrees move; `unblock` only moves
   *  them and then replays the operation the live-PTY gate refused; `reauth`
   *  closes what blocks, keeps every pin, and reopens the closed terminals. */
  mode: 'remove' | 'unblock' | 'reauth'
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

/** The sign-in already landed, so a worktree we could not relaunch is a notice,
 *  never a failure of the operation the user asked for. */
function reportClaudeReauthReopenFailures(outcome: ClaudeReauthReopenOutcome): void {
  if (outcome.failedWorktreeIds.length === 0) {
    return
  }
  toast.warning(
    translate(
      'auto.components.settings.useClaudeAccountReassign.reopenFailed',
      'Signed in, but Orca Lab could not reopen the Claude terminal in {{worktrees}}. Start it again from the tab bar.',
      { worktrees: outcome.failedWorktreeIds.join(', ') }
    )
  )
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
      // Why read it now: closing the dialog drops the report, and after the
      // terminals die nothing else remembers which worktrees to reopen.
      const closedWorktreeIds =
        confirmation.intent === 'keep-pins' && report
          ? planClaudeAccountReassignment(report).liveWorktrees.map(
              (worktree) => worktree.worktreeId
            )
          : []
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
              reassignPinnedTo: confirmation.intent === 'reassign' ? confirmation.toAccountId : null
            })
          }
          const reassigned = await reassignClaudeWorktreeAccounts(settings, {
            fromAccountId: accountId,
            ...(confirmation.intent === 'keep-pins'
              ? { intent: 'keep-pins' as const }
              : {
                  intent: 'reassign' as const,
                  toAccountId: confirmation.toAccountId
                }),
            ...closeOptions
          })
          const next = retry ? await retry() : reassigned
          // Why after the retry resolves: a terminal spawned earlier takes a
          // launch reservation and the close gate refuses the re-auth outright.
          if (confirmation.intent === 'keep-pins') {
            reportClaudeReauthReopenFailures(reopenClaudeTerminalsAfterReauth(closedWorktreeIds))
          }
          return next
        },
        runtime
      )
    },
    [report, runAction, settings, target]
  )

  return { target, report, destination, setDestination, open, close, confirm }
}
