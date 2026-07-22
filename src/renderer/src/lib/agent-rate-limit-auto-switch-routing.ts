import type { AutoSwitchRateLimitAgent } from '../../../shared/agent-rate-limit-detection'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session-resume'
import type { ClaudeLivePtyAccountInfo } from '../../../shared/types'
import { useAppStore } from '@/store'
import type { AutoSwitchAccountCandidate } from './agent-rate-limit-auto-switch'
import type { AccountsSnapshotResult } from './agent-rate-limit-account-snapshot'
import {
  runLastResortFailoverIfConfigured,
  type AgentRateLimitFailoverMode
} from './agent-rate-limit-failover'
import { runManagedAccountSwitchRelaunch } from './agent-rate-limit-account-switch'

export type AgentRateLimitAutoSwitchResult =
  | {
      ok: true
      agent: AutoSwitchRateLimitAgent
      accountLabel: string
      /** Present when the session continued on the last-resort custom-endpoint account. */
      failover?: AgentRateLimitFailoverMode
      /** Present when a pinned managed session was relaunched on another OAuth account in a new tab. */
      relaunch?: AgentRateLimitFailoverMode
    }
  | {
      ok: false
      reason:
        | 'disabled'
        | 'ssh'
        | 'no-account'
        | 'custom-endpoint-session'
        | 'stop-failed'
        | 'resume-failed'
        | 'continue-failed'
        | 'switch-failed'
      message: string
    }

type AutoSwitchFailureReason = Extract<AgentRateLimitAutoSwitchResult, { ok: false }>['reason']

/** Shapes a failure result; keeps the runner's many exit points scannable. */
export function failure(
  reason: AutoSwitchFailureReason,
  message: string
): AgentRateLimitAutoSwitchResult {
  return { ok: false, reason, message }
}

/** Formats unknown async failures for toast-safe structured runner results. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Maps the no-quota last-resort failover outcome onto the runner result, or null when not configured. */
export async function tryLastResortFailover(args: {
  worktreeId: string
  ptyId: string
  agent: AutoSwitchRateLimitAgent
  providerSession: AgentProviderSessionMetadata
  snapshot: AccountsSnapshotResult
  livePtyAccount: ClaudeLivePtyAccountInfo | null
}): Promise<AgentRateLimitAutoSwitchResult | null> {
  // Why: last-resort failover uses the per-worktree pin, which only exists for
  // local worktrees; remote runtimes keep the plain no-account outcome.
  if (args.agent !== 'claude' || args.snapshot.target.kind !== 'local') {
    return null
  }
  const failoverResult = await runLastResortFailoverIfConfigured({
    worktreeId: args.worktreeId,
    ptyId: args.ptyId,
    providerSession: args.providerSession,
    accounts: args.snapshot.accounts.claude.accounts,
    livePtyAccount: args.livePtyAccount,
    settings: useAppStore.getState().settings
  })
  if (!failoverResult) {
    return null
  }
  if (failoverResult.ok) {
    return {
      ok: true,
      agent: args.agent,
      accountLabel: failoverResult.accountLabel,
      failover: failoverResult.failover
    }
  }
  return failure(
    failoverResult.reason === 'pin-failed' ? 'switch-failed' : failoverResult.reason,
    failoverResult.message
  )
}

/**
 * Relaunches a pinned managed (injected) Claude session on the chosen OAuth
 * account in a new tab, or null when the session is not an injected local pin.
 *
 * Why: a pinned worktree's PTY has an isolated CLAUDE_CONFIG_DIR fixed at spawn,
 * so the global selectAccount + same-PTY resume can never re-point it. It must
 * copy the transcript, re-pin, and relaunch — exactly like the endpoint failover.
 */
export async function tryPinnedManagedSwitch(args: {
  worktreeId: string
  ptyId: string
  agent: AutoSwitchRateLimitAgent
  providerSession: AgentProviderSessionMetadata
  snapshot: AccountsSnapshotResult
  candidate: AutoSwitchAccountCandidate
  livePtyAccount: ClaudeLivePtyAccountInfo | null
}): Promise<AgentRateLimitAutoSwitchResult | null> {
  // Why: only an injected pin on a LOCAL worktree can be re-pinned + relaunched;
  // the non-injected/global-selection case keeps the same-PTY resume, and remote
  // runtimes have no local pin or tab to relaunch into.
  if (
    args.agent !== 'claude' ||
    args.snapshot.target.kind !== 'local' ||
    args.livePtyAccount?.injected !== true
  ) {
    return null
  }
  const targetAccount = args.snapshot.accounts.claude.accounts.find(
    (account) => account.id === args.candidate.accountId
  )
  if (!targetAccount) {
    return null
  }
  const result = await runManagedAccountSwitchRelaunch({
    worktreeId: args.worktreeId,
    ptyId: args.ptyId,
    providerSession: args.providerSession,
    targetAccount,
    sourceAccountId: args.livePtyAccount.accountId,
    settings: useAppStore.getState().settings
  })
  if (result.ok) {
    return {
      ok: true,
      agent: args.agent,
      accountLabel: result.accountLabel,
      relaunch: result.switched
    }
  }
  return failure(
    result.reason === 'pin-failed' || result.reason === 'invalid-target'
      ? 'switch-failed'
      : result.reason,
    result.message
  )
}
