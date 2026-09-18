import type {
  Automation,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun,
  AutomationShellCommand,
  AutomationShellResult
} from '../../shared/automations-types'
import {
  didAutomationShellRunSucceed,
  formatAutomationShellFailure
} from '../../shared/automation-shell-result'
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
}): Promise<AutomationRun | null> {
  const { store, automation, run, target, command } = input
  const precheckResult =
    run.trigger === 'scheduled' && automation.precheck ? await input.runPrecheck() : null
  if (precheckResult && !didAutomationShellRunSucceed(precheckResult)) {
    return updateAutomationRunIfStillStored(store, automation.id, {
      runId: run.id,
      status: 'skipped_precheck',
      workspaceId: null,
      precheckResult,
      error: formatAutomationShellFailure(precheckResult, 'Precheck')
    })
  }
  updateAutomationRunIfStillStored(store, automation.id, {
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
  const succeeded = didAutomationShellRunSucceed(commandResult)
  return updateAutomationRunIfStillStored(store, automation.id, {
    runId: run.id,
    status: succeeded ? 'completed' : 'command_failed',
    workspaceId: null,
    precheckResult,
    commandResult,
    outputSnapshot: buildCommandRunOutputSnapshot(commandResult),
    error: succeeded ? null : formatAutomationShellFailure(commandResult, 'Command')
  })
}

/**
 * Arranca la corrida y devuelve la fila en `dispatching` sin esperar el
 * comando: su runtime es shell del usuario (hasta 600s), y esperarlo aca
 * congelaba la evaluacion de todas las demas filas y la respuesta de
 * `automations:runNow`. El final lo escribe el store cuando el comando sale.
 *
 * `inFlight` guarda las corridas vivas por automatizacion: el scheduler las
 * arranca y sigue, y esa llave impide que dos corridas de la misma fila se
 * pisen.
 */
export function startCommandOnlyAutomationRun(input: {
  store: Store
  automation: Automation
  run: AutomationRun
  target: Extract<AutomationRunTargetResult, { ok: true }>
  command: AutomationShellCommand
  runPrecheck: () => Promise<AutomationPrecheckResult | null>
  inFlight: Map<string, Promise<void>>
}): AutomationRun {
  const { store, automation, run, inFlight } = input
  if (inFlight.has(automation.id)) {
    return store.updateAutomationRun({
      runId: run.id,
      status: 'skipped_unavailable',
      workspaceId: null,
      error: 'The previous run of this automation is still running.'
    })
  }
  const dispatching = store.updateAutomationRun({
    runId: run.id,
    status: 'dispatching',
    workspaceId: null,
    error: null
  })
  const settled = dispatchCommandOnlyAutomationRun({ ...input, run: dispatching })
    .then(() => undefined)
    .catch((cause: unknown) => {
      // Nadie espera esta promesa, asi que un throw dejaria la fila clavada
      // en `dispatching` para siempre.
      updateAutomationRunIfStillStored(store, automation.id, {
        runId: run.id,
        status: 'dispatch_failed',
        workspaceId: null,
        error: cause instanceof Error ? cause.message : String(cause)
      })
    })
    .finally(() => {
      inFlight.delete(automation.id)
    })
    // Ultima red: esta promesa no la espera nadie, asi que un fallo del propio
    // manejo de errores tiene que morir aca y no como rechazo sin dueno.
    .catch((cause: unknown) => {
      console.error(`[automations] ${automation.id}: could not close the command run:`, cause)
    })
  inFlight.set(automation.id, settled)
  return dispatching
}

/**
 * Escribe el estado solo si la fila sigue guardada.
 *
 * Nadie espera la promesa de una corrida command-only, asi que un `throw` del
 * store no tiene donde caer: borrar la automatizacion (o apagar el plugin que
 * la aporta) mientras el comando corre borra tambien sus corridas, y el cierre
 * de la corrida terminaba en un rechazo sin dueno capaz de tumbar el main.
 */
export function updateAutomationRunIfStillStored(
  store: Store,
  automationId: string,
  result: AutomationDispatchResult
): AutomationRun | null {
  if (!store.listAutomationRuns(automationId).some((entry) => entry.id === result.runId)) {
    return null
  }
  return store.updateAutomationRun(result)
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
