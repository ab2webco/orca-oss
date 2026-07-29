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
import { resolveLocalWindowsAgentStartupShell } from '../../../shared/windows-terminal-shell'
import { resolveStartupShell } from '../../../shared/tui-agent-startup-shell'
import { buildAgentResumeStartupPlan, type AgentStartupPlan } from '@/lib/tui-agent-startup'
import { stopForegroundAgent, waitForResumedAgent } from '@/lib/agent-rate-limit-terminal-control'
import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-inspection'
import { deliverLaunchPromptToAgentTab } from '@/lib/agent-launch-prompt-delivery'
import { appendTabToWorktreeOrder } from '@/lib/sleeping-agent-session-launch'
import {
  getFailoverAccountLabel,
  type AgentRateLimitFailoverMode
} from '@/lib/agent-rate-limit-failover'
import { runInPlaceManagedClaudeAccountSwitch } from '@/lib/agent-rate-limit-in-place-account-switch'

export type AgentRateLimitAccountSwitchResult =
  | { ok: true; accountLabel: string; switched: AgentRateLimitFailoverMode }
  | {
      ok: false
      reason: 'invalid-target' | 'stop-failed' | 'pin-failed' | 'resume-failed'
      message: string
    }

const ACCOUNT_SWITCH_CONTINUE_READINESS_TIMEOUT_MS = 20_000

function accountsShareRuntime(
  source: ClaudeManagedAccountSummary | undefined,
  target: ClaudeManagedAccountSummary
): boolean {
  if (!source) {
    return false
  }
  const sourceRuntime = source.managedAuthRuntime === 'wsl' ? 'wsl' : 'host'
  const targetRuntime = target.managedAuthRuntime === 'wsl' ? 'wsl' : 'host'
  return (
    sourceRuntime === targetRuntime &&
    (sourceRuntime === 'host' || source.wslDistro?.trim() === target.wslDistro?.trim())
  )
}

/**
 * Puts the original agent back in the same PTY after a failure that follows the stop.
 *
 * Why this is possible: at this point only the CLI process is gone. The PTY still
 * carries the source account's injected CLAUDE_CONFIG_DIR and main still holds its
 * live binding — nothing is released until beginClaudeAccountSwitch — so re-running
 * the very resume command the switch was going to use lands the user back exactly
 * where they were instead of on a bare shell with the conversation stranded.
 */
function describeRestoreOutcome(restored: boolean): string {
  return restored
    ? translate(
        'auto.lib.agentRateLimitAccountSwitch.restoredOnOrigin',
        'Orca resumed the session on the original account.'
      )
    : translate(
        'auto.lib.agentRateLimitAccountSwitch.restoreFailed',
        'Orca could not bring the session back; resume it from this terminal.'
      )
}

async function restoreStoppedAgentOnSourceAccount(args: {
  settings: GlobalSettings | null
  ptyId: string
  resumePlan: AgentStartupPlan
}): Promise<boolean> {
  const sent = await sendRuntimePtyInputVerified(
    args.settings,
    args.ptyId,
    `${args.resumePlan.launchCommand}\r`
  ).catch(() => false)
  if (!sent) {
    return false
  }
  return waitForResumedAgent({
    settings: args.settings,
    ptyId: args.ptyId,
    agent: 'claude',
    expectedProcess: args.resumePlan.expectedProcess
  }).catch(() => false)
}

/**
 * Switches a pinned Claude worktree from one managed OAUTH account to another:
 * stop the limited CLI, copy the transcript into the target account's isolated
 * universe, re-pin the worktree, and resume inside the same shell PTY. Main
 * releases the exited foreground CLI's binding and atomically accounts the
 * resumed CLI against the destination account. A new tab is only a preflight
 * fallback when main cannot prove the existing PTY is a healthy idle shell.
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
  const fallbackShell =
    args.targetAccount.managedAuthRuntime === 'wsl'
      ? 'posix'
      : (resolveLocalWindowsAgentStartupShell({
          platform: CLIENT_PLATFORM,
          isRemote: false,
          terminalWindowsShell: args.settings?.terminalWindowsShell
        }) ?? resolveStartupShell(CLIENT_PLATFORM))
  const planBase = {
    cmdOverrides: args.settings?.agentCmdOverrides ?? {},
    agentArgs: resolveTuiAgentLaunchArgs('claude', args.settings?.agentDefaultArgs),
    agentEnv: resolveTuiAgentLaunchEnv('claude', args.settings?.agentDefaultEnv),
    platform: CLIENT_PLATFORM
  }
  const buildResumePlan = (shell: 'posix' | 'powershell' | 'cmd'): AgentStartupPlan | null =>
    buildAgentResumeStartupPlan({
      agent: 'claude',
      providerSession: args.providerSession,
      ...planBase,
      shell
    })
  const resumePlan = buildResumePlan(fallbackShell)
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
  const sourceAccount =
    typeof args.sourceAccountId === 'string'
      ? args.settings?.claudeManagedAccounts.find((account) => account.id === args.sourceAccountId)
      : undefined
  const canAttemptInPlace = accountsShareRuntime(sourceAccount, args.targetAccount)

  if (canAttemptInPlace) {
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
  }

  /**
   * Ends a switch that already stopped the agent, putting that agent back first.
   *
   * Why: the stop happens before anything else is known to work, so an abort after
   * it used to leave the terminal sitting at a shell prompt with the conversation
   * lost — the reported symptom. The pin stays on the source account here, since a
   * restored source-account CLI under a target-account pin would make the fail-back
   * watcher describe a switch that never happened.
   */
  const abortAfterStop = async (
    reason: 'resume-failed' | 'pin-failed',
    message: string
  ): Promise<AgentRateLimitAccountSwitchResult> => {
    if (!canAttemptInPlace) {
      return { ok: false, reason, message }
    }
    const restored = await restoreStoppedAgentOnSourceAccount({
      settings: args.settings,
      ptyId: args.ptyId,
      resumePlan
    })
    return { ok: false, reason, message: `${message} ${describeRestoreOutcome(restored)}` }
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

  // Why before the pin: without the transcript the destination has nothing to resume,
  // so the switch is over — and the worktree must not be left pinned to an account
  // that never received the session.
  if (!copyResult.ok) {
    return abortAfterStop(
      'resume-failed',
      translate(
        'auto.lib.agentRateLimitAccountSwitch.copyFailed',
        'Could not copy the session transcript into the selected account.'
      )
    )
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
    return abortAfterStop(
      'pin-failed',
      translate(
        'auto.lib.agentRateLimitAccountSwitch.pinFailed',
        'Could not assign the selected account to this worktree: {{value0}}',
        { value0: error instanceof Error ? error.message : String(error) }
      )
    )
  }

  if (canAttemptInPlace) {
    const inPlace = await runInPlaceManagedClaudeAccountSwitch({
      ptyId: args.ptyId,
      sourceAccountId: args.sourceAccountId,
      targetAccount: args.targetAccount,
      buildResumePlan
    })
    if (inPlace.ok) {
      return { ok: true, accountLabel, switched: inPlace.switched }
    }
    if (inPlace.reason !== 'unhealthy') {
      // Why the abort reports this instead of retrying here: past begin, the PTY's
      // binding and its exported config dir both belong to the transition, so only
      // that path can hand them back to the source account.
      return {
        ok: false,
        reason: 'resume-failed',
        message: `${inPlace.message} ${describeRestoreOutcome(inPlace.restored === true)}`
      }
    }
  }

  const state = useAppStore.getState()
  const tab = state.createTab(args.worktreeId, undefined, undefined, { launchAgent: 'claude' })
  state.queueTabStartupCommand(tab.id, {
    command: resumePlan.launchCommand,
    ...(resumePlan.env ? { env: resumePlan.env } : {}),
    launchConfig: resumePlan.launchConfig,
    launchAgent: 'claude',
    resumeProviderSession: args.providerSession
  })
  state.claimAutomaticAgentResume(tab.id, {
    worktreeId: args.worktreeId,
    launchAgent: 'claude',
    providerSession: args.providerSession
  })
  state.setActiveTabType('terminal')
  appendTabToWorktreeOrder(args.worktreeId, tab.id)

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
