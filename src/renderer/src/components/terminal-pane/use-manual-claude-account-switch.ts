import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  resolveClaudeSessionBackingAccount,
  runRateLimitFailoverRelaunch,
  type AgentRateLimitFailoverMode
} from '@/lib/agent-rate-limit-failover'
import { runManagedAccountSwitchRelaunch } from '@/lib/agent-rate-limit-account-switch'
import type { ClaudeManagedAccountSummary } from '../../../../shared/types'
import type { AgentProviderSessionMetadata } from '../../../../shared/agent-session-resume'

export type ManualClaudeAccountSwitchContext = {
  ptyId: string
  providerSession: AgentProviderSessionMetadata
}

/** Label a managed account by its endpoint label when present, else its email. */
export function claudeAccountSwitchLabel(account: ClaudeManagedAccountSummary): string {
  return account.endpointLabel?.trim() || account.email
}

function notifyRelaunch(
  accountLabel: string,
  mode: AgentRateLimitFailoverMode,
  toastFn: typeof toast.success
): void {
  toastFn(
    translate(
      'auto.components.terminalPane.useManualClaudeAccountSwitch.doneTitle',
      'Switched this terminal to {{value0}}.',
      { value0: accountLabel }
    ),
    {
      description:
        mode === 'resumed'
          ? translate(
              'auto.components.terminalPane.useManualClaudeAccountSwitch.doneResumed',
              'The session resumed in a new tab and continue was sent.'
            )
          : mode === 'launched'
            ? translate(
                'auto.components.terminalPane.useManualClaudeAccountSwitch.doneLaunched',
                'The session resumed in a new tab, but continue was not delivered — send it manually.'
              )
            : translate(
                'auto.components.terminalPane.useManualClaudeAccountSwitch.doneFresh',
                'The transcript could not be copied, so the session starts fresh in a new tab.'
              )
    }
  )
}

/**
 * User-triggered switch of the CURRENT terminal's Claude account: copies the
 * transcript into the target account's universe, re-pins the worktree, and
 * relaunches in a new tab. Routes a managed OAuth target through the
 * managed-switch relaunch and a custom-endpoint target through the failover
 * relaunch. Neither path touches the gated global selectAccount, so it works
 * even when the global account gate would block a global switch.
 */
export function useManualClaudeAccountSwitch(args: { worktreeId: string }): {
  switchToAccount: (
    context: ManualClaudeAccountSwitchContext | null,
    account: ClaudeManagedAccountSummary
  ) => void
} {
  const { worktreeId } = args
  const switchToAccount = useCallback(
    (
      context: ManualClaudeAccountSwitchContext | null,
      account: ClaudeManagedAccountSummary
    ): void => {
      if (!context) {
        toast.error(
          translate(
            'auto.components.terminalPane.useManualClaudeAccountSwitch.noSession',
            'No resumable Claude session was found in this terminal.'
          )
        )
        return
      }
      const accountLabel = claudeAccountSwitchLabel(account)
      void (async () => {
        const backing = await resolveClaudeSessionBackingAccount(context.ptyId)
        const sourceAccountId = backing.info?.injected ? backing.info.accountId : null
        const settings = useAppStore.getState().settings
        toast.info(
          translate(
            'auto.components.terminalPane.useManualClaudeAccountSwitch.startTitle',
            'Switching this terminal to {{value0}}…',
            { value0: accountLabel }
          )
        )
        try {
          if (account.authMethod === 'custom-endpoint') {
            const result = await runRateLimitFailoverRelaunch({
              worktreeId,
              ptyId: context.ptyId,
              providerSession: context.providerSession,
              failoverAccount: account,
              sourceAccountId,
              settings
            })
            if (result.ok) {
              notifyRelaunch(result.accountLabel, result.failover, toast.info)
            } else {
              toast.error(
                translate(
                  'auto.components.terminalPane.useManualClaudeAccountSwitch.failed',
                  'Account switch failed.'
                ),
                { description: result.message }
              )
            }
            return
          }
          const result = await runManagedAccountSwitchRelaunch({
            worktreeId,
            ptyId: context.ptyId,
            providerSession: context.providerSession,
            targetAccount: account,
            sourceAccountId,
            settings
          })
          if (result.ok) {
            notifyRelaunch(result.accountLabel, result.switched, toast.success)
          } else {
            toast.error(
              translate(
                'auto.components.terminalPane.useManualClaudeAccountSwitch.failed',
                'Account switch failed.'
              ),
              { description: result.message }
            )
          }
        } catch (error) {
          toast.error(
            translate(
              'auto.components.terminalPane.useManualClaudeAccountSwitch.failed',
              'Account switch failed.'
            ),
            { description: error instanceof Error ? error.message : String(error) }
          )
        }
      })()
    },
    [worktreeId]
  )
  return { switchToAccount }
}
