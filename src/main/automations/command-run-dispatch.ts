import type {
  Automation,
  AutomationPrecheckResult,
  AutomationRun,
  AutomationShellCommand,
  AutomationShellResult
} from '../../shared/automations-types'
import {
  didAutomationPrecheckPass,
  formatAutomationPrecheckFailure
} from '../../shared/automation-precheck'
import {
  didAutomationCommandSucceed,
  formatAutomationCommandFailure
} from '../../shared/automation-command-run'
import type { Store } from '../persistence'
import { runAutomationPrecheck } from './precheck-runner'
import type { AutomationRunTargetResult } from './run-target-resolution'

/**
 * Una corrida command-only: corre el comando y termina.
 *
 * Ni ventana, ni terminal, ni cuenta de agente, ni modelo — el sentido de esta
 * forma es que sea barata, asi que se resuelve entera en el main. El runner es
 * el del precheck, con los mismos limites: el timeout que declara el comando y
 * la salida acotada a `MAX_AUTOMATION_PRECHECK_OUTPUT_CHARS`, en el cwd del
 * destino resuelto y con el entorno del proceso de Orca.
 *
 * El estado final distingue las tres cosas que se confunden: no valia la pena
 * correr (`skipped_precheck`), corrio y fallo (`command_failed`), corrio y
 * salio bien (`completed`).
 */
export async function dispatchCommandOnlyAutomationRun(input: {
  store: Store
  automation: Automation
  run: AutomationRun
  target: Extract<AutomationRunTargetResult, { ok: true }>
  command: AutomationShellCommand
  runPrecheck: () => Promise<AutomationPrecheckResult | null>
}): Promise<AutomationRun> {
  const { store, automation, run, target, command } = input
  const precheckResult =
    run.trigger === 'scheduled' && automation.precheck ? await input.runPrecheck() : null
  if (precheckResult && !didAutomationPrecheckPass(precheckResult)) {
    return store.updateAutomationRun({
      runId: run.id,
      status: 'skipped_precheck',
      workspaceId: null,
      precheckResult,
      error: formatAutomationPrecheckFailure(precheckResult)
    })
  }
  store.updateAutomationRun({
    runId: run.id,
    status: 'dispatching',
    workspaceId: null,
    error: null
  })
  const commandResult = await runAutomationPrecheck({
    precheck: command,
    target:
      automation.executionTargetType === 'ssh'
        ? { type: 'ssh', cwd: target.cwd, connectionId: automation.executionTargetId }
        : { type: 'local', cwd: target.cwd }
  })
  const succeeded = didAutomationCommandSucceed(commandResult)
  return store.updateAutomationRun({
    runId: run.id,
    status: succeeded ? 'completed' : 'command_failed',
    workspaceId: null,
    precheckResult,
    commandResult,
    outputSnapshot: buildCommandRunOutputSnapshot(commandResult),
    error: succeeded ? null : formatAutomationCommandFailure(commandResult)
  })
}

/** La salida del comando, para que el historial muestre algo y no una corrida
 *  vacia: es justo la falla que esta feature no debe reproducir. */
function buildCommandRunOutputSnapshot(
  result: AutomationShellResult
): AutomationRun['outputSnapshot'] {
  const content = [result.stdout, result.stderr]
    .filter((part) => part.trim())
    .join('\n')
    .trim()
  if (!content) {
    return null
  }
  return {
    format: 'plain_text',
    content,
    capturedAt: result.completedAt,
    truncated: result.stdoutTruncated || result.stderrTruncated
  }
}
