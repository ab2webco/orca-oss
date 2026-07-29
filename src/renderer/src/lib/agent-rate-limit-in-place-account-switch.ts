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
  /** `restored` reports whether the original agent is running again; absent when nothing was stopped. */
  | { ok: false; reason: 'unhealthy' | 'failed'; message: string; restored?: boolean }

export async function runInPlaceManagedClaudeAccountSwitch(args: {
  ptyId: string
  sourceAccountId: string | null
  targetAccount: ClaudeManagedAccountSummary
  buildResumePlan(shell: 'posix' | 'powershell' | 'cmd'): AgentStartupPlan | null
}): Promise<InPlaceManagedClaudeSwitchResult> {
  const runtime = args.targetAccount.managedAuthRuntime === 'wsl' ? 'wsl' : 'host'
  const wslDistro = args.targetAccount.wslDistro ?? null
  const transition =
    typeof args.sourceAccountId === 'string'
      ? await window.api.pty.beginClaudeAccountSwitch({
          ptyId: args.ptyId,
          sourceAccountId: args.sourceAccountId,
          targetAccountId: args.targetAccount.id,
          runtime,
          wslDistro
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

  /**
   * Ends the switch and puts the source account's CLI back in this PTY.
   *
   * Why the config dir has to come from main: the transition command exported
   * CLAUDE_CONFIG_DIR for the destination, and that export outlives the failed
   * attempt — a bare resume here would boot the original session into the wrong
   * universe. Main re-prepares the source, hands its binding back, and returns the
   * dir to point the shell at.
   */
  const abortAndRestore = async (message: string): Promise<InPlaceManagedClaudeSwitchResult> => {
    const aborted = await window.api.pty
      .abortClaudeAccountSwitch({
        ptyId: args.ptyId,
        // Why non-null: a null source never reaches begin, so there is no transition to abort.
        sourceAccountId: args.sourceAccountId ?? '',
        reservationId: transition.reservationId,
        runtime,
        wslDistro
      })
      .catch(() => ({ ok: false, reason: 'prepare-failed' }) as const)
    const sourcePlan = args.buildResumePlan(transition.shell)
    if (!aborted.ok || !sourcePlan) {
      return { ok: false, reason: 'failed', message, restored: false }
    }
    const settings = useAppStore.getState().settings
    const restoreCommand = buildClaudeInPlaceResumeCommand({
      configDir: aborted.configDir,
      resumeCommand: sourcePlan.launchCommand,
      shell: transition.shell
    })
    const sent = await sendRuntimePtyInputVerified(settings, args.ptyId, `${restoreCommand}\r`)
    if (!sent) {
      return { ok: false, reason: 'failed', message, restored: false }
    }
    const restored = await waitForResumedAgent({
      settings,
      ptyId: args.ptyId,
      agent: 'claude',
      expectedProcess: sourcePlan.expectedProcess
    })
    return { ok: false, reason: 'failed', message, restored }
  }

  const resumePlan = args.buildResumePlan(transition.shell)
  if (!resumePlan) {
    return abortAndRestore(
      translate(
        'auto.lib.agentRateLimitAccountSwitch.resumePlanFailed',
        'Could not build a resume command for the switched session.'
      )
    )
  }
  const command = buildClaudeInPlaceResumeCommand({
    configDir: transition.configDir,
    resumeCommand: resumePlan.launchCommand,
    shell: transition.shell
  })
  const settings = useAppStore.getState().settings
  const launched = await sendRuntimePtyInputVerified(settings, args.ptyId, `${command}\r`)
  if (!launched) {
    return abortAndRestore(
      translate(
        'auto.lib.agentRateLimitAccountSwitch.resumeInputFailed',
        'The terminal did not accept the resume command after switching accounts.'
      )
    )
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
    return abortAndRestore(
      translate(
        'auto.lib.agentRateLimitAccountSwitch.resumeTimedOut',
        'The resumed agent did not take over the terminal in time.'
      )
    )
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
    return abortAndRestore(
      translate(
        'auto.lib.agentRateLimitAccountSwitch.accountingFailed',
        'The resumed terminal could not be assigned to the selected account.'
      )
    )
  }

  await waitForAgentReadyInput()
  const continued = await sendRuntimePtyInputVerified(settings, args.ptyId, 'continue\r')
  return { ok: true, switched: continued ? 'resumed' : 'launched' }
}
