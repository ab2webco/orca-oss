import {
  CLAUDE_FAILOVER_ORIGIN_SHARED,
  type ClaudeManagedAccountSummary,
  type ClaudeSessionFailoverCopyResult,
  type GlobalSettings,
  type Worktree
} from '../../../shared/types'
import type { RateLimitState } from '../../../shared/rate-limit-types'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session-resume'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import {
  buildAgentResumeStartupPlan,
  buildAgentStartupPlan,
  type AgentStartupPlan
} from '@/lib/tui-agent-startup'
import { stopForegroundAgent } from '@/lib/agent-rate-limit-terminal-control'
import { deliverLaunchPromptToAgentTab } from '@/lib/agent-launch-prompt-delivery'
import { appendTabToWorktreeOrder } from '@/lib/sleeping-agent-session-launch'

export type AgentRateLimitFailBackMode = 'resumed' | 'launched' | 'fresh'

export type AgentRateLimitFailBackResult =
  | { ok: true; accountLabel: string; failBack: AgentRateLimitFailBackMode }
  | { ok: false; reason: 'stop-failed' | 'pin-failed' | 'resume-failed'; message: string }

export type FailBackReadiness =
  | { ready: true; originAccountId: string | null; originLabel: string }
  | { ready: false; reason: 'not-failover' | 'not-reset-yet' | 'origin-missing' | 'still-limited' }

const FAIL_BACK_CONTINUE_READINESS_TIMEOUT_MS = 20_000
/** Fallback when the limited window's reset timestamp was unknown at failover time. */
const FAIL_BACK_DEFAULT_RESET_DELAY_MS = 5 * 60 * 60 * 1000 + 5 * 60 * 1000

/** Best-known reset time of the account that just hit its limit: the earliest
 *  future window reset, else now + one 5h window as a conservative estimate. */
export function resolveFailoverOriginResetsAt(args: {
  rateLimits: Pick<RateLimitState, 'claude' | 'inactiveClaudeAccounts'>
  /** Managed account backing the limited PTY, or null for the active/shared selection. */
  sourceAccountId: string | null
  now: number
}): number {
  const windows =
    args.sourceAccountId === null
      ? [args.rateLimits.claude?.session, args.rateLimits.claude?.weekly]
      : (() => {
          const inactive = args.rateLimits.inactiveClaudeAccounts.find(
            (entry) => entry.accountId === args.sourceAccountId
          )
          return inactive
            ? [inactive.rateLimits?.session, inactive.rateLimits?.weekly]
            : [args.rateLimits.claude?.session, args.rateLimits.claude?.weekly]
        })()
  const futureResets = windows
    .map((window) => window?.resetsAt ?? null)
    .filter((resetsAt): resetsAt is number => typeof resetsAt === 'number' && resetsAt > args.now)
  if (futureResets.length > 0) {
    return Math.min(...futureResets)
  }
  return args.now + FAIL_BACK_DEFAULT_RESET_DELAY_MS
}

/** Whether a failed-over worktree is ready to return to its origin account. */
export function evaluateFailBackReadiness(args: {
  worktree: Pick<
    Worktree,
    'claudeAccountId' | 'claudeFailoverOriginAccountId' | 'claudeFailoverResetsAt'
  >
  accounts: readonly ClaudeManagedAccountSummary[]
  rateLimits: Pick<RateLimitState, 'inactiveClaudeAccounts'>
  now: number
}): FailBackReadiness {
  const origin = args.worktree.claudeFailoverOriginAccountId
  if (typeof origin !== 'string' || origin.length === 0 || !args.worktree.claudeAccountId) {
    return { ready: false, reason: 'not-failover' }
  }
  const resetsAt = args.worktree.claudeFailoverResetsAt
  if (typeof resetsAt === 'number' && args.now < resetsAt) {
    return { ready: false, reason: 'not-reset-yet' }
  }
  if (origin === CLAUDE_FAILOVER_ORIGIN_SHARED) {
    return {
      ready: true,
      originAccountId: null,
      originLabel: translate(
        'auto.lib.agentRateLimitFailBack.globalSelectionLabel',
        'the global account selection'
      )
    }
  }
  const originAccount = args.accounts.find((account) => account.id === origin)
  if (!originAccount) {
    return { ready: false, reason: 'origin-missing' }
  }
  // Why: reset time is the primary signal, but a fresh per-account snapshot
  // proving the origin is STILL saturated postpones the offer instead of
  // bouncing the user straight back into the limit.
  const usage = args.rateLimits.inactiveClaudeAccounts.find((entry) => entry.accountId === origin)
  if (usage && usage.updatedAt > (typeof resetsAt === 'number' ? resetsAt : 0)) {
    const windows = [usage.rateLimits?.session, usage.rateLimits?.weekly]
    const stillLimited = windows.some(
      (window) =>
        window &&
        window.usedPercent >= 99 &&
        typeof window.resetsAt === 'number' &&
        window.resetsAt > args.now
    )
    if (stillLimited) {
      return { ready: false, reason: 'still-limited' }
    }
  }
  return { ready: true, originAccountId: origin, originLabel: originAccount.email }
}

/**
 * Returns a failed-over worktree to its origin account: stop the endpoint CLI,
 * copy the transcript back into the origin universe, restore the pre-failover
 * pin, and relaunch in a NEW tab (same mechanics as the forward failover — a
 * live PTY can never swap its CLAUDE_CONFIG_DIR in place).
 */
export async function runRateLimitFailBack(args: {
  worktreeId: string
  ptyId: string
  providerSession: AgentProviderSessionMetadata
  /** Endpoint account the worktree is currently pinned to. */
  endpointAccountId: string
  /** Origin to restore: managed account id, or null for the global selection. */
  originAccountId: string | null
  originLabel: string
  settings: GlobalSettings | null
}): Promise<AgentRateLimitFailBackResult> {
  const planBase = {
    cmdOverrides: args.settings?.agentCmdOverrides ?? {},
    agentArgs: resolveTuiAgentLaunchArgs('claude', args.settings?.agentDefaultArgs),
    agentEnv: resolveTuiAgentLaunchEnv('claude', args.settings?.agentDefaultEnv),
    platform: CLIENT_PLATFORM
  }
  const resumePlan = buildAgentResumeStartupPlan({
    agent: 'claude',
    providerSession: args.providerSession,
    ...planBase
  })
  if (!resumePlan) {
    return {
      ok: false,
      reason: 'resume-failed',
      message: translate(
        'auto.lib.agentRateLimitFailBack.resumePlanFailed',
        'Could not build a resume command for the restored session.'
      )
    }
  }

  const stopped = await stopForegroundAgent({
    settings: args.settings,
    ptyId: args.ptyId,
    agent: 'claude',
    expectedProcess: resumePlan.expectedProcess
  })
  if (!stopped) {
    return {
      ok: false,
      reason: 'stop-failed',
      message: translate(
        'auto.lib.agentRateLimitFailBack.stopFailed',
        'The endpoint agent did not exit after Ctrl+C, so Orca left the terminal untouched.'
      )
    }
  }

  const worktreePath = useAppStore.getState().getKnownWorktreeById(args.worktreeId)?.path ?? null
  let copyResult: ClaudeSessionFailoverCopyResult = { ok: false, reason: 'copy-failed' }
  if (worktreePath) {
    try {
      copyResult = await window.api.claudeAccounts.copySessionForFailBack({
        sessionId: args.providerSession.id,
        cwd: worktreePath,
        sourceAccountId: args.endpointAccountId,
        targetAccountId: args.originAccountId
      })
    } catch {
      copyResult = { ok: false, reason: 'copy-failed' }
    }
  }

  try {
    // Why: restoring the pre-failover pin (or clearing it) is the fail-back;
    // the failover marker fields are cleared so the watcher never re-fires.
    await useAppStore.getState().updateWorktreeMeta(args.worktreeId, {
      claudeAccountId: args.originAccountId,
      claudeFailoverOriginAccountId: null,
      claudeFailoverResetsAt: null
    })
  } catch (error) {
    return {
      ok: false,
      reason: 'pin-failed',
      message: translate(
        'auto.lib.agentRateLimitFailBack.pinFailed',
        'Could not restore the original account on this worktree: {{value0}}',
        { value0: error instanceof Error ? error.message : String(error) }
      )
    }
  }

  const startupPlan: AgentStartupPlan | null = copyResult.ok
    ? resumePlan
    : buildAgentStartupPlan({
        agent: 'claude',
        prompt: '',
        allowEmptyPromptLaunch: true,
        ...planBase
      })
  if (!startupPlan) {
    return {
      ok: false,
      reason: 'resume-failed',
      message: translate(
        'auto.lib.agentRateLimitFailBack.launchPlanFailed',
        'Could not build a launch command for the restored session.'
      )
    }
  }

  const state = useAppStore.getState()
  const tab = state.createTab(args.worktreeId, undefined, undefined, { launchAgent: 'claude' })
  state.queueTabStartupCommand(tab.id, {
    command: startupPlan.launchCommand,
    ...(startupPlan.env ? { env: startupPlan.env } : {}),
    launchConfig: startupPlan.launchConfig,
    launchAgent: 'claude',
    ...(copyResult.ok ? { resumeProviderSession: args.providerSession } : {})
  })
  if (copyResult.ok) {
    state.claimAutomaticAgentResume(tab.id, {
      worktreeId: args.worktreeId,
      launchAgent: 'claude',
      providerSession: args.providerSession
    })
  }
  state.setActiveTabType('terminal')
  appendTabToWorktreeOrder(args.worktreeId, tab.id)

  if (!copyResult.ok) {
    return { ok: true, accountLabel: args.originLabel, failBack: 'fresh' }
  }

  // Why: forcePaste — claude's native --prefill shortcut only applies to launch flags, not a resumed session.
  const continued = await deliverLaunchPromptToAgentTab({
    tabId: tab.id,
    agent: 'claude',
    content: 'continue',
    submit: true,
    forcePaste: true,
    timeoutMs: FAIL_BACK_CONTINUE_READINESS_TIMEOUT_MS
  }).catch(() => false)
  return { ok: true, accountLabel: args.originLabel, failBack: continued ? 'resumed' : 'launched' }
}
