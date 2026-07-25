import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  evaluateFailBackReadiness,
  restoreFailoverOriginPin,
  runRateLimitFailBack,
  type AgentRateLimitFailBackResult
} from '@/lib/agent-rate-limit-fail-back'
import type { AgentProviderSessionMetadata } from '../../../../shared/agent-session-resume'

const FAIL_BACK_CHECK_INTERVAL_MS = 60_000
/** Why: an ignored offer must come back — the worktree is still stuck on the
 *  failover account — but not every minute. Re-offer on this cadence instead. */
const FAIL_BACK_REOFFER_COOLDOWN_MS = 15 * 60_000
// Why: module-scoped — split panes and tab remounts must offer each worktree's
// return trip once per app session, not once per mounted pane.
const handledWorktreeIds = new Set<string>()
const evaluatingWorktreeIds = new Set<string>()
/** Worktrees whose offer is on cooldown, keyed by when it may be shown again. */
const offeredAtByWorktreeId = new Map<string, number>()

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
      const mode = state.settings?.rateLimitFailBackMode ?? 'auto'
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
        // Why: no live pane means the endpoint tab was closed or its agent exited.
        // The return trip used to bail out here and the worktree stayed pinned to
        // the endpoint forever — restoring the pin needs no session at all.
        const context = getLiveClaudePaneContext()
        const performFailBack = (): void => {
          // Why marked here and not before the offer: marking on sight meant a
          // dismissed/expired toast silenced the return for the whole app session.
          handledWorktreeIds.add(worktreeId)
          void (
            context
              ? runRateLimitFailBack({
                  worktreeId,
                  ptyId: context.ptyId,
                  providerSession: context.providerSession,
                  currentAccountId,
                  currentAccountIsCustomEndpoint,
                  originAccountId: readiness.originAccountId,
                  originLabel: readiness.originLabel,
                  settings: useAppStore.getState().settings
                })
              : restoreFailoverOriginPin({
                  worktreeId,
                  originAccountId: readiness.originAccountId,
                  originLabel: readiness.originLabel
                })
          )
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
        const offeredAt = offeredAtByWorktreeId.get(worktreeId)
        if (
          typeof offeredAt === 'number' &&
          Date.now() - offeredAt < FAIL_BACK_REOFFER_COOLDOWN_MS
        ) {
          return
        }
        offeredAtByWorktreeId.set(worktreeId, Date.now())
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
              : result.failBack === 'pinned'
                ? translate(
                    'auto.components.terminalPane.useAgentRateLimitFailBack.donePinned',
                    'No session was running, so the next terminal you open here starts on it.'
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
