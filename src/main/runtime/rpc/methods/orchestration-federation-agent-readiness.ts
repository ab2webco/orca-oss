import type { RuntimeTerminalWait } from '../../../../shared/runtime-types'
import { AGENT_COMPOSER_READY_TIMEOUT_MS } from '../../agent-composer-readiness'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'

const STARTUP_DELIVERY_POLL_MS = 100

export type FederatedAgentReadiness = {
  wait: RuntimeTerminalWait
  composerReadyProven: boolean
}

/**
 * The remote twin of the local ORCA-191 readiness wait, plus a refusal the local
 * path lacks: a remote host's shell can outlive the shell-ready budget, and then
 * nothing but this check stands between the TASK text and that shell (ORCA-792).
 * Every stage shares the one budget the home transport timeout is sized from.
 */
export async function awaitFederatedAgentReadiness(args: {
  runtime: OrcaRuntimeService
  terminalHandle: string
  budgetMs: number
}): Promise<FederatedAgentReadiness> {
  const { runtime, terminalHandle } = args
  const deadline = Date.now() + args.budgetMs
  let wait = await runtime.waitForTerminal(terminalHandle, {
    condition: 'tui-idle',
    timeoutMs: args.budgetMs
  })
  // Why: a slow shell still delivers the launch command once it reaches its prompt.
  if (!wait.satisfied && wait.blockedReason === 'shell-startup-command-withheld') {
    if (await waitForStartupCommandDelivery(runtime, terminalHandle, deadline)) {
      wait = await runtime.waitForTerminal(terminalHandle, {
        condition: 'tui-idle',
        timeoutMs: Math.max(1, deadline - Date.now())
      })
    }
  }
  if (!wait.satisfied) {
    return { wait, composerReadyProven: false }
  }
  const composer = await runtime.waitForAgentComposerReady(terminalHandle, {
    timeoutMs: Math.max(0, Math.min(AGENT_COMPOSER_READY_TIMEOUT_MS, deadline - Date.now()))
  })
  if (runtime.isTerminalStartupCommandWithheld(terminalHandle)) {
    throw agentNotStarted(
      'the launch command is still withheld behind the shell startup (shell-startup-command-withheld)'
    )
  }
  if (!(await runtime.isTerminalRunningAgent(terminalHandle))) {
    throw agentNotStarted('no agent owns the pane; it is still a shell')
  }
  return { wait, composerReadyProven: composer.proven }
}

function agentNotStarted(reason: string): OrchestrationError {
  return new OrchestrationError(
    'agent_not_started',
    `agent_not_started: ${reason}. Nothing was typed into the terminal.`
  )
}

async function waitForStartupCommandDelivery(
  runtime: OrcaRuntimeService,
  terminalHandle: string,
  deadline: number
): Promise<boolean> {
  while (runtime.isTerminalStartupCommandWithheld(terminalHandle)) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      return false
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(STARTUP_DELIVERY_POLL_MS, remainingMs))
    )
  }
  return deadline - Date.now() > 0
}
