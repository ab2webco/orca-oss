import type {
  ClaudeLivePtyAccountInfo,
  ClaudeManagedAccountSummary,
  ClaudeSessionFailoverCopyResult,
  GlobalSettings
} from '../../../shared/types'
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

/** How the failover tab ended up: resumed+continued, resumed but continue undelivered, or a fresh session. */
export type AgentRateLimitFailoverMode = 'resumed' | 'launched' | 'fresh'

export type AgentRateLimitFailoverResult =
  | { ok: true; accountLabel: string; failover: AgentRateLimitFailoverMode }
  | { ok: false; reason: 'stop-failed' | 'pin-failed' | 'resume-failed'; message: string }

const FAILOVER_CONTINUE_READINESS_TIMEOUT_MS = 20_000

export function getFailoverAccountLabel(account: ClaudeManagedAccountSummary): string {
  return account.endpointLabel?.trim() || account.email
}

/** Reads the account backing a live local Claude PTY and whether it is a custom-endpoint universe. */
export async function resolveClaudeSessionBackingAccount(ptyId: string): Promise<{
  info: ClaudeLivePtyAccountInfo | null
  isCustomEndpoint: boolean
}> {
  let info: ClaudeLivePtyAccountInfo | null = null
  try {
    info = await window.api.claudeAccounts.getLivePtyAccount({ ptyId })
  } catch {
    info = null
  }
  const backingAccountId = info?.accountId
  if (!backingAccountId) {
    return { info, isCustomEndpoint: false }
  }
  try {
    const state = await window.api.claudeAccounts.list()
    const backingAccount = state.accounts.find((account) => account.id === backingAccountId)
    return { info, isCustomEndpoint: backingAccount?.authMethod === 'custom-endpoint' }
  } catch {
    // Why: an unreadable account list must not block a legitimate Anthropic auto-switch.
    return { info, isCustomEndpoint: false }
  }
}

/** Runs the last-resort relaunch when a valid failover account is configured; null = not configured. */
export async function runLastResortFailoverIfConfigured(args: {
  worktreeId: string
  ptyId: string
  providerSession: AgentProviderSessionMetadata
  accounts: readonly ClaudeManagedAccountSummary[]
  livePtyAccount: ClaudeLivePtyAccountInfo | null
  settings: GlobalSettings | null
}): Promise<AgentRateLimitFailoverResult | null> {
  const failoverAccount = resolveRateLimitFailoverAccount({
    settings: args.settings,
    accounts: args.accounts
  })
  if (!failoverAccount) {
    return null
  }
  return runRateLimitFailoverRelaunch({
    worktreeId: args.worktreeId,
    ptyId: args.ptyId,
    providerSession: args.providerSession,
    failoverAccount,
    sourceAccountId: args.livePtyAccount?.injected ? args.livePtyAccount.accountId : null,
    settings: args.settings
  })
}

/** Resolves the configured last-resort failover account; only an existing custom-endpoint account qualifies. */
export function resolveRateLimitFailoverAccount(args: {
  settings: Pick<GlobalSettings, 'rateLimitFailoverAccountId'> | null | undefined
  accounts: readonly ClaudeManagedAccountSummary[]
}): ClaudeManagedAccountSummary | null {
  const failoverAccountId = args.settings?.rateLimitFailoverAccountId
  if (typeof failoverAccountId !== 'string' || failoverAccountId.length === 0) {
    return null
  }
  const account = args.accounts.find((entry) => entry.id === failoverAccountId)
  // Why: the pinned-universe relaunch only makes sense for endpoint accounts; a stale id must read as "off".
  return account?.authMethod === 'custom-endpoint' ? account : null
}

/**
 * Last-resort failover: stop the limited Claude CLI, copy its transcript into
 * the custom-endpoint account's universe, pin the worktree to that account, and
 * relaunch in a NEW agent tab.
 *
 * Why a new tab: CLAUDE_CONFIG_DIR is injected at PTY spawn from the worktree
 * pin, so the existing PTY's shell can never adopt the endpoint universe — only
 * a fresh spawn goes through main's injected-account preparation and live-pty
 * accounting.
 */
export async function runRateLimitFailoverRelaunch(args: {
  worktreeId: string
  ptyId: string
  providerSession: AgentProviderSessionMetadata
  failoverAccount: ClaudeManagedAccountSummary
  /** Managed account backing the limited PTY (injected pin), or null for shared ~/.claude. */
  sourceAccountId: string | null
  settings: GlobalSettings | null
}): Promise<AgentRateLimitFailoverResult> {
  const accountLabel = getFailoverAccountLabel(args.failoverAccount)
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
        'auto.lib.agentRateLimitFailover.resumePlanFailed',
        'Could not build a resume command for the failover session.'
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
        'auto.lib.agentRateLimitFailover.stopFailed',
        'The limited agent did not exit after Ctrl+C, so Orca left the terminal untouched.'
      )
    }
  }

  // Why: a missing worktree path just means the transcript cannot be located; failover still proceeds fresh.
  const worktreePath = useAppStore.getState().getKnownWorktreeById(args.worktreeId)?.path ?? null
  let copyResult: ClaudeSessionFailoverCopyResult = { ok: false, reason: 'copy-failed' }
  if (worktreePath) {
    try {
      copyResult = await window.api.claudeAccounts.copySessionForFailover({
        sessionId: args.providerSession.id,
        cwd: worktreePath,
        targetAccountId: args.failoverAccount.id,
        sourceAccountId: args.sourceAccountId
      })
    } catch {
      copyResult = { ok: false, reason: 'copy-failed' }
    }
  }

  try {
    // Why: the per-worktree pin is the honest mechanism — the worktree visibly runs on the endpoint until the user changes it.
    await useAppStore
      .getState()
      .updateWorktreeMeta(args.worktreeId, { claudeAccountId: args.failoverAccount.id })
  } catch (error) {
    return {
      ok: false,
      reason: 'pin-failed',
      message: translate(
        'auto.lib.agentRateLimitFailover.pinFailed',
        'Could not assign the failover account to this worktree: {{value0}}',
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
        'auto.lib.agentRateLimitFailover.launchPlanFailed',
        'Could not build a launch command for the failover session.'
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
    return { ok: true, accountLabel, failover: 'fresh' }
  }

  // Why: forcePaste — claude's native --prefill shortcut only applies to launch flags, not a resumed session.
  const continued = await deliverLaunchPromptToAgentTab({
    tabId: tab.id,
    agent: 'claude',
    content: 'continue',
    submit: true,
    forcePaste: true,
    timeoutMs: FAILOVER_CONTINUE_READINESS_TIMEOUT_MS
  }).catch(() => false)
  return { ok: true, accountLabel, failover: continued ? 'resumed' : 'launched' }
}
