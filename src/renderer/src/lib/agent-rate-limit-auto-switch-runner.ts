import type { AutoSwitchRateLimitAgent } from '../../../shared/agent-rate-limit-detection'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session-resume'
import type { ClaudeLivePtyAccountInfo } from '../../../shared/types'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { useAppStore } from '@/store'
import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-inspection'
import { translate } from '@/i18n/i18n'
import { buildAgentResumeStartupPlan } from './tui-agent-startup'
import { selectAutoSwitchAccount } from './agent-rate-limit-auto-switch'
import {
  loadAccountsSnapshot,
  selectAccount,
  type AccountsSnapshotResult
} from './agent-rate-limit-account-snapshot'
import {
  stopForegroundAgent,
  waitForAgentReadyInput,
  waitForResumedAgent
} from './agent-rate-limit-terminal-control'
import { resolveAgentRateLimitResumePlatform } from './agent-rate-limit-resume-platform'
import {
  resolveClaudeSessionBackingAccount,
  runLastResortFailoverIfConfigured,
  type AgentRateLimitFailoverMode
} from './agent-rate-limit-failover'

export type AgentRateLimitAutoSwitchResult =
  | {
      ok: true
      agent: AutoSwitchRateLimitAgent
      accountLabel: string
      /** Present when the session continued on the last-resort custom-endpoint account. */
      failover?: AgentRateLimitFailoverMode
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
function failure(reason: AutoSwitchFailureReason, message: string): AgentRateLimitAutoSwitchResult {
  return { ok: false, reason, message }
}

/** Formats unknown async failures for toast-safe structured runner results. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Maps the no-quota last-resort failover outcome onto the runner result, or null when not configured. */
async function tryLastResortFailover(args: {
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

/** Runs the stop/switch/resume/continue flow for a detected account-limit event. */
export async function runAgentRateLimitAutoSwitch(args: {
  ptyId: string
  worktreeId: string
  agent: AutoSwitchRateLimitAgent
  providerSession: AgentProviderSessionMetadata
  connectionId: string | null
}): Promise<AgentRateLimitAutoSwitchResult> {
  const settings = useAppStore.getState().settings
  if (settings?.autoSwitchRateLimitedAccounts !== true) {
    return failure(
      'disabled',
      translate('auto.lib.agentRateLimitAutoSwitchRunner.07ff1f8806', 'Auto-switch is disabled.')
    )
  }
  if (args.connectionId) {
    return failure(
      'ssh',
      translate(
        'auto.lib.agentRateLimitAutoSwitchRunner.7e5d87791a',
        'Auto-switch is not available for SSH terminals because account auth lives on the remote host.'
      )
    )
  }

  // Why: a custom-endpoint (gateway) session can emit Anthropic-shaped limit
  // errors, but its universe has no quota to switch; never Ctrl+C it.
  let livePtyAccount: ClaudeLivePtyAccountInfo | null = null
  if (args.agent === 'claude') {
    const backing = await resolveClaudeSessionBackingAccount(args.ptyId)
    livePtyAccount = backing.info
    if (backing.isCustomEndpoint) {
      return failure(
        'custom-endpoint-session',
        translate(
          'auto.lib.agentRateLimitAutoSwitchRunner.customEndpointSession',
          'This session runs on a custom endpoint account; its errors are not Anthropic account limits.'
        )
      )
    }
  }

  let snapshot: AccountsSnapshotResult
  try {
    snapshot = await loadAccountsSnapshot({ agent: args.agent, ptyId: args.ptyId })
  } catch (error) {
    return failure(
      'switch-failed',
      translate(
        'auto.lib.agentRateLimitAutoSwitchRunner.65e8e278a4',
        'Could not inspect managed accounts: {{value0}}',
        { value0: errorMessage(error) }
      )
    )
  }
  const providerTarget =
    args.agent === 'claude'
      ? snapshot.accounts.rateLimits.claudeTarget
      : snapshot.accounts.rateLimits.codexTarget
  const candidate = selectAutoSwitchAccount({
    agent: args.agent,
    accounts: snapshot.accounts,
    target:
      snapshot.target.kind === 'environment' ? { runtime: 'host', wslDistro: null } : providerTarget
  })
  if (!candidate) {
    const failoverOutcome = await tryLastResortFailover({
      worktreeId: args.worktreeId,
      ptyId: args.ptyId,
      agent: args.agent,
      providerSession: args.providerSession,
      snapshot,
      livePtyAccount
    })
    if (failoverOutcome) {
      return failoverOutcome
    }
    return failure(
      'no-account',
      translate(
        'auto.lib.agentRateLimitAutoSwitchRunner.d823b157d5',
        'No managed {{value0}} account with available quota was found.',
        { value0: args.agent === 'claude' ? 'Claude' : 'Codex' }
      )
    )
  }

  let platform: NodeJS.Platform
  try {
    platform = await resolveAgentRateLimitResumePlatform({
      target: snapshot.target,
      accountTarget: candidate.target
    })
  } catch (error) {
    return failure(
      'resume-failed',
      translate(
        'auto.lib.agentRateLimitAutoSwitchRunner.a939f58b30',
        'Could not resolve the resume platform: {{value0}}',
        { value0: errorMessage(error) }
      )
    )
  }
  const localSettings = snapshot.target.kind === 'local' ? settings : null
  const resumePlan = buildAgentResumeStartupPlan({
    agent: args.agent,
    providerSession: args.providerSession,
    cmdOverrides: localSettings?.agentCmdOverrides ?? {},
    agentArgs: resolveTuiAgentLaunchArgs(args.agent, localSettings?.agentDefaultArgs),
    agentEnv: resolveTuiAgentLaunchEnv(args.agent, localSettings?.agentDefaultEnv),
    platform
  })
  if (!resumePlan) {
    return failure(
      'resume-failed',
      translate(
        'auto.lib.agentRateLimitAutoSwitchRunner.79751c2c2d',
        'Could not build a resume command for the limited agent session.'
      )
    )
  }

  const stopped = await stopForegroundAgent({
    settings,
    ptyId: args.ptyId,
    agent: args.agent,
    expectedProcess: resumePlan.expectedProcess
  })
  if (!stopped) {
    return failure(
      'stop-failed',
      translate(
        'auto.lib.agentRateLimitAutoSwitchRunner.13668a6034',
        'The limited agent did not exit after Ctrl+C, so Orca left the terminal untouched.'
      )
    )
  }

  try {
    await selectAccount({
      agent: args.agent,
      runtimeTarget: snapshot.target,
      candidate
    })
  } catch (error) {
    return failure('switch-failed', errorMessage(error))
  }

  const launched = await sendRuntimePtyInputVerified(
    useAppStore.getState().settings,
    args.ptyId,
    `${resumePlan.launchCommand}\r`
  )
  if (!launched) {
    return failure(
      'resume-failed',
      translate(
        'auto.lib.agentRateLimitAutoSwitchRunner.9553d26436',
        'The terminal did not accept the resume command after switching accounts.'
      )
    )
  }

  const resumed = await waitForResumedAgent({
    settings: useAppStore.getState().settings,
    ptyId: args.ptyId,
    agent: args.agent,
    expectedProcess: resumePlan.expectedProcess
  })
  if (!resumed) {
    return failure(
      'resume-failed',
      translate(
        'auto.lib.agentRateLimitAutoSwitchRunner.13ccffb514',
        'The resumed agent did not take over the terminal in time.'
      )
    )
  }

  await waitForAgentReadyInput()
  const continued = await sendRuntimePtyInputVerified(
    useAppStore.getState().settings,
    args.ptyId,
    'continue\r'
  )
  if (!continued) {
    return failure(
      'continue-failed',
      translate(
        'auto.lib.agentRateLimitAutoSwitchRunner.65d1f14b75',
        'The resumed agent did not accept the continue command.'
      )
    )
  }

  return { ok: true, agent: args.agent, accountLabel: candidate.label }
}
