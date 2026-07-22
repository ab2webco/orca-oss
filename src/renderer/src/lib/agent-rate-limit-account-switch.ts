import {
  CLAUDE_FAILOVER_ORIGIN_SHARED,
  type ClaudeManagedAccountSummary,
  type ClaudeSessionFailoverCopyResult,
  type GlobalSettings
} from '../../../shared/types'
import { resolveFailoverOriginResetsAt } from '@/lib/agent-rate-limit-fail-back'
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
import {
  getFailoverAccountLabel,
  type AgentRateLimitFailoverMode
} from '@/lib/agent-rate-limit-failover'

export type AgentRateLimitAccountSwitchResult =
  | { ok: true; accountLabel: string; switched: AgentRateLimitFailoverMode }
  | {
      ok: false
      reason: 'invalid-target' | 'stop-failed' | 'pin-failed' | 'resume-failed'
      message: string
    }

const ACCOUNT_SWITCH_CONTINUE_READINESS_TIMEOUT_MS = 20_000

/**
 * Switches a pinned Claude worktree from one managed OAUTH account to another:
 * stop the limited CLI, copy the transcript into the target account's isolated
 * universe, re-pin the worktree, and relaunch in a NEW agent tab.
 *
 * Why a new tab (same as the endpoint failover): CLAUDE_CONFIG_DIR is injected
 * at PTY spawn from the worktree pin, so a live PTY can never adopt the target
 * account's universe in place — only a fresh spawn goes through main's injected
 * account preparation and live-pty accounting.
 *
 * The managed→managed sibling of runRateLimitFailoverRelaunch; the target here
 * MUST be an OAuth account (custom-endpoint targets keep using the failover path).
 */
export async function runManagedAccountSwitchRelaunch(args: {
  worktreeId: string
  ptyId: string
  providerSession: AgentProviderSessionMetadata
  /** Managed OAuth account to switch to; a custom-endpoint account is rejected. */
  targetAccount: ClaudeManagedAccountSummary
  /** Managed account backing the limited PTY (injected pin), or null for shared ~/.claude. */
  sourceAccountId: string | null
  settings: GlobalSettings | null
}): Promise<AgentRateLimitAccountSwitchResult> {
  if (args.targetAccount.authMethod === 'custom-endpoint') {
    return {
      ok: false,
      reason: 'invalid-target',
      message: translate(
        'auto.lib.agentRateLimitAccountSwitch.invalidTarget',
        'That account runs on a custom endpoint; use the failover path instead of a managed account switch.'
      )
    }
  }

  const accountLabel = getFailoverAccountLabel(args.targetAccount)
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
        'auto.lib.agentRateLimitAccountSwitch.resumePlanFailed',
        'Could not build a resume command for the switched session.'
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
        'auto.lib.agentRateLimitAccountSwitch.stopFailed',
        'The limited agent did not exit after Ctrl+C, so Orca left the terminal untouched.'
      )
    }
  }

  // Why: a missing worktree path just means the transcript cannot be located; the switch still proceeds fresh.
  const worktreePath = useAppStore.getState().getKnownWorktreeById(args.worktreeId)?.path ?? null
  let copyResult: ClaudeSessionFailoverCopyResult = { ok: false, reason: 'copy-failed' }
  if (worktreePath) {
    try {
      copyResult = await window.api.claudeAccounts.copySessionForAccountSwitch({
        sessionId: args.providerSession.id,
        cwd: worktreePath,
        targetAccountId: args.targetAccount.id,
        sourceAccountId: args.sourceAccountId
      })
    } catch {
      copyResult = { ok: false, reason: 'copy-failed' }
    }
  }

  try {
    // Why: the origin + reset markers let the fail-back watcher offer the return
    // trip once the origin account recovers quota — managed→managed fail-back
    // reuses copySessionForAccountSwitch in reverse to return the transcript home.
    await useAppStore.getState().updateWorktreeMeta(args.worktreeId, {
      claudeAccountId: args.targetAccount.id,
      claudeFailoverOriginAccountId: args.sourceAccountId ?? CLAUDE_FAILOVER_ORIGIN_SHARED,
      claudeFailoverResetsAt: resolveFailoverOriginResetsAt({
        rateLimits: useAppStore.getState().rateLimits,
        sourceAccountId: args.sourceAccountId,
        now: Date.now()
      })
    })
  } catch (error) {
    return {
      ok: false,
      reason: 'pin-failed',
      message: translate(
        'auto.lib.agentRateLimitAccountSwitch.pinFailed',
        'Could not assign the selected account to this worktree: {{value0}}',
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
        'auto.lib.agentRateLimitAccountSwitch.launchPlanFailed',
        'Could not build a launch command for the switched session.'
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
    return { ok: true, accountLabel, switched: 'fresh' }
  }

  // Why: forcePaste — claude's native --prefill shortcut only applies to launch flags, not a resumed session.
  const continued = await deliverLaunchPromptToAgentTab({
    tabId: tab.id,
    agent: 'claude',
    content: 'continue',
    submit: true,
    forcePaste: true,
    timeoutMs: ACCOUNT_SWITCH_CONTINUE_READINESS_TIMEOUT_MS
  }).catch(() => false)
  return { ok: true, accountLabel, switched: continued ? 'resumed' : 'launched' }
}
