import type { ClaudeManagedAccountSummary } from '../../../shared/types'
import type { AgentStartupPlan } from '../../../shared/tui-agent-startup'
import { buildClaudeInPlaceResumeCommand } from '../../../shared/claude-in-place-resume-command'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  stopForegroundAgent,
  waitForAgentReadyInput,
  waitForResumedAgent
} from '@/lib/agent-rate-limit-terminal-control'
import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-inspection'
import type { AgentRateLimitFailoverMode } from '@/lib/agent-rate-limit-failover'

export type InPlaceManagedClaudeSwitchResult =
  | { ok: true; switched: AgentRateLimitFailoverMode }
  | { ok: false; reason: 'unhealthy' | 'failed'; message: string }

export async function runInPlaceManagedClaudeAccountSwitch(args: {
  ptyId: string
  sourceAccountId: string | null
  targetAccount: ClaudeManagedAccountSummary
  buildResumePlan(shell: 'posix' | 'powershell' | 'cmd'): AgentStartupPlan | null
}): Promise<InPlaceManagedClaudeSwitchResult> {
  const transition =
    typeof args.sourceAccountId === 'string'
      ? await window.api.pty.beginClaudeAccountSwitch({
          ptyId: args.ptyId,
          sourceAccountId: args.sourceAccountId,
          targetAccountId: args.targetAccount.id,
          runtime: args.targetAccount.managedAuthRuntime === 'wsl' ? 'wsl' : 'host',
          wslDistro: args.targetAccount.wslDistro ?? null
        })
      : ({ ok: false, reason: 'unhealthy' } as const)

  if (!transition.ok) {
    return transition.reason === 'unhealthy' || transition.reason === 'runtime-mismatch'
      ? { ok: false, reason: 'unhealthy', message: '' }
      : {
          ok: false,
          reason: 'failed',
          message: translate(
            'auto.lib.agentRateLimitAccountSwitch.preparationFailed',
            'Could not prepare the selected account for this terminal.'
          )
        }
  }

  const resumePlan = args.buildResumePlan(transition.shell)
  if (!resumePlan) {
    await window.api.pty.cancelClaudeAccountSwitch({ reservationId: transition.reservationId })
    return {
      ok: false,
      reason: 'failed',
      message: translate(
        'auto.lib.agentRateLimitAccountSwitch.resumePlanFailed',
        'Could not build a resume command for the switched session.'
      )
    }
  }
  const command = buildClaudeInPlaceResumeCommand({
    configDir: transition.configDir,
    resumeCommand: resumePlan.launchCommand,
    shell: transition.shell
  })
  const settings = useAppStore.getState().settings
  const launched = await sendRuntimePtyInputVerified(settings, args.ptyId, `${command}\r`)
  if (!launched) {
    await window.api.pty.cancelClaudeAccountSwitch({ reservationId: transition.reservationId })
    return {
      ok: false,
      reason: 'failed',
      message: translate(
        'auto.lib.agentRateLimitAccountSwitch.resumeInputFailed',
        'The terminal did not accept the resume command after switching accounts.'
      )
    }
  }

  const resumed = await waitForResumedAgent({
    settings,
    ptyId: args.ptyId,
    agent: 'claude',
    expectedProcess: resumePlan.expectedProcess
  })
  if (!resumed) {
    await stopForegroundAgent({
      settings,
      ptyId: args.ptyId,
      agent: 'claude',
      expectedProcess: resumePlan.expectedProcess
    })
    await window.api.pty.cancelClaudeAccountSwitch({ reservationId: transition.reservationId })
    return {
      ok: false,
      reason: 'failed',
      message: translate(
        'auto.lib.agentRateLimitAccountSwitch.resumeTimedOut',
        'The resumed agent did not take over the terminal in time.'
      )
    }
  }

  const committed = await window.api.pty.commitClaudeAccountSwitch({
    ptyId: args.ptyId,
    targetAccountId: args.targetAccount.id,
    reservationId: transition.reservationId
  })
  if (!committed) {
    await stopForegroundAgent({
      settings,
      ptyId: args.ptyId,
      agent: 'claude',
      expectedProcess: resumePlan.expectedProcess
    })
    await window.api.pty.cancelClaudeAccountSwitch({ reservationId: transition.reservationId })
    return {
      ok: false,
      reason: 'failed',
      message: translate(
        'auto.lib.agentRateLimitAccountSwitch.accountingFailed',
        'The resumed terminal could not be assigned to the selected account.'
      )
    }
  }

  await waitForAgentReadyInput()
  const continued = await sendRuntimePtyInputVerified(settings, args.ptyId, 'continue\r')
  return { ok: true, switched: continued ? 'resumed' : 'launched' }
}
