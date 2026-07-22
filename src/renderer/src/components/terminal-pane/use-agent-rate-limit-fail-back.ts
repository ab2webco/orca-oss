import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  evaluateFailBackReadiness,
  runRateLimitFailBack,
  type AgentRateLimitFailBackResult
} from '@/lib/agent-rate-limit-fail-back'
import type { AgentProviderSessionMetadata } from '../../../../shared/agent-session-resume'

const FAIL_BACK_CHECK_INTERVAL_MS = 60_000
// Why: module-scoped — split panes and tab remounts must offer each worktree's
// return trip once per app session, not once per mounted pane.
const handledWorktreeIds = new Set<string>()
const evaluatingWorktreeIds = new Set<string>()

export type LiveClaudePaneContext = {
  ptyId: string
  providerSession: AgentProviderSessionMetadata
}

/**
 * Watches a failed-over worktree for its origin account's quota recovery and,
 * per the rateLimitFailBackMode setting, offers (toast action) or performs the
 * fail-back. Mounted by TerminalPane so the live endpoint pane's PTY and
 * provider session are at hand — the same context the forward failover used.
 */
export function useAgentRateLimitFailBack(args: {
  worktreeId: string
  getLiveClaudePaneContext: () => LiveClaudePaneContext | null
}): void {
  const { worktreeId, getLiveClaudePaneContext } = args
  useEffect(() => {
    const tick = async (): Promise<void> => {
      const state = useAppStore.getState()
      const mode = state.settings?.rateLimitFailBackMode ?? 'notify'
      if (mode === 'off') {
        return
      }
      if (handledWorktreeIds.has(worktreeId) || evaluatingWorktreeIds.has(worktreeId)) {
        return
      }
      const worktree = state.getKnownWorktreeById(worktreeId)
      const currentAccountId = worktree?.claudeAccountId
      // Cheap local gate before any IPC: only failover-marked worktrees whose
      // reset moment has passed proceed to the account lookup.
      if (
        !worktree?.claudeFailoverOriginAccountId ||
        !currentAccountId ||
        (typeof worktree.claudeFailoverResetsAt === 'number' &&
          Date.now() < worktree.claudeFailoverResetsAt)
      ) {
        return
      }
      evaluatingWorktreeIds.add(worktreeId)
      try {
        const accountsState = await window.api.claudeAccounts.list().catch(() => null)
        if (!accountsState) {
          return
        }
        // Why: the copy-back path differs by universe — endpoint failovers restore
        // via copySessionForFailBack, managed→managed switches via the symmetric
        // account-switch copy.
        const currentAccountIsCustomEndpoint =
          accountsState.accounts.find((account) => account.id === currentAccountId)?.authMethod ===
          'custom-endpoint'
        const readiness = evaluateFailBackReadiness({
          worktree,
          accounts: accountsState.accounts,
          rateLimits: useAppStore.getState().rateLimits,
          now: Date.now()
        })
        if (!readiness.ready) {
          if (readiness.reason === 'origin-missing') {
            // Why: a deleted origin account can never be returned to; clear the
            // marker so this worktree stops evaluating forever.
            handledWorktreeIds.add(worktreeId)
            await useAppStore.getState().updateWorktreeMeta(worktreeId, {
              claudeFailoverOriginAccountId: null,
              claudeFailoverResetsAt: null
            })
          }
          return
        }
        const context = getLiveClaudePaneContext()
        if (!context) {
          return
        }
        handledWorktreeIds.add(worktreeId)
        const performFailBack = (): void => {
          void runRateLimitFailBack({
            worktreeId,
            ptyId: context.ptyId,
            providerSession: context.providerSession,
            currentAccountId,
            currentAccountIsCustomEndpoint,
            originAccountId: readiness.originAccountId,
            originLabel: readiness.originLabel,
            settings: useAppStore.getState().settings
          })
            .then((result) => notifyFailBackResult(result, worktreeId))
            .catch((error) => {
              handledWorktreeIds.delete(worktreeId)
              toast.error(
                translate(
                  'auto.components.terminalPane.useAgentRateLimitFailBack.failed',
                  'Fail-back failed.'
                ),
                { description: error instanceof Error ? error.message : String(error) }
              )
            })
        }
        if (mode === 'auto') {
          toast.info(
            translate(
              'auto.components.terminalPane.useAgentRateLimitFailBack.autoTitle',
              '{{value0}} has quota again — returning this worktree to it.',
              { value0: readiness.originLabel }
            )
          )
          performFailBack()
          return
        }
        toast.info(
          translate(
            'auto.components.terminalPane.useAgentRateLimitFailBack.notifyTitle',
            '{{value0}} has quota again.',
            { value0: readiness.originLabel }
          ),
          {
            description: translate(
              'auto.components.terminalPane.useAgentRateLimitFailBack.notifyDescription',
              'This worktree is still on the failover account. Switch back and resume the session?'
            ),
            duration: 60_000,
            action: {
              label: translate(
                'auto.components.terminalPane.useAgentRateLimitFailBack.notifyAction',
                'Switch back'
              ),
              onClick: performFailBack
            }
          }
        )
      } finally {
        evaluatingWorktreeIds.delete(worktreeId)
      }
    }
    const timer = setInterval(() => void tick(), FAIL_BACK_CHECK_INTERVAL_MS)
    void tick()
    return () => clearInterval(timer)
  }, [worktreeId, getLiveClaudePaneContext])
}

function notifyFailBackResult(result: AgentRateLimitFailBackResult, worktreeId: string): void {
  if (result.ok) {
    toast.success(
      translate(
        'auto.components.terminalPane.useAgentRateLimitFailBack.doneTitle',
        'Back on {{value0}}.',
        { value0: result.accountLabel }
      ),
      {
        description:
          result.failBack === 'resumed'
            ? translate(
                'auto.components.terminalPane.useAgentRateLimitFailBack.doneResumed',
                'The session resumed in a new tab and continue was sent.'
              )
            : result.failBack === 'launched'
              ? translate(
                  'auto.components.terminalPane.useAgentRateLimitFailBack.doneLaunched',
                  'The session resumed in a new tab, but continue was not delivered — send it manually.'
                )
              : translate(
                  'auto.components.terminalPane.useAgentRateLimitFailBack.doneFresh',
                  'The transcript could not be copied back, so the session starts fresh in a new tab.'
                )
      }
    )
    return
  }
  // Why: releasing the guard lets a later tick retry after a transient failure.
  handledWorktreeIds.delete(worktreeId)
  toast.error(
    translate('auto.components.terminalPane.useAgentRateLimitFailBack.failed', 'Fail-back failed.'),
    { description: result.message }
  )
}
