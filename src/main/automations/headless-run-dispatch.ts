import type {
  Automation,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun
} from '../../shared/automations-types'
import {
  didAutomationPrecheckPass,
  formatAutomationPrecheckFailure
} from '../../shared/automation-precheck'
import type { Store } from '../persistence'
import type { HeadlessAutomationDispatcher } from './headless-dispatch'
import type { AutomationRunTargetResult } from './run-target-resolution'

/**
 * La corrida de una fila con agente cuando no hay ventana: `orca serve` crea el
 * workspace y lanza el agente por su cuenta. Vive fuera de `AutomationService`
 * porque es un camino entero (precheck, lanzamiento, cierre diferido) y no un
 * detalle del planificador.
 */
export async function dispatchHeadlessAutomationRun(input: {
  store: Store
  dispatcher: HeadlessAutomationDispatcher
  automation: Automation
  run: AutomationRun
  target: Extract<AutomationRunTargetResult, { ok: true }>
  runPrecheck: () => Promise<AutomationPrecheckResult | null>
  markDispatchResult: (result: AutomationDispatchResult) => Promise<AutomationRun>
}): Promise<AutomationRun> {
  const { store, dispatcher, automation, run, target, runPrecheck, markDispatchResult } = input
  const precheckResult =
    run.trigger === 'scheduled' && automation.precheck ? await runPrecheck() : null
  if (precheckResult && !didAutomationPrecheckPass(precheckResult)) {
    return store.updateAutomationRun({
      runId: run.id,
      status: 'skipped_precheck',
      workspaceId: automation.workspaceId,
      precheckResult,
      error: formatAutomationPrecheckFailure(precheckResult)
    })
  }
  try {
    const launch = await dispatcher({ automation, run, target })
    const launchRunTarget = {
      workspaceId: launch.workspaceId,
      workspaceDisplayName: launch.workspaceDisplayName ?? null,
      terminalSessionId: launch.terminalSessionId,
      terminalPaneKey: launch.terminalPaneKey ?? null,
      terminalPtyId: launch.terminalPtyId ?? null
    }
    const updated = store.updateAutomationRun({
      runId: run.id,
      status: 'dispatched',
      ...launchRunTarget,
      error: null
    })
    if (launch.completion) {
      void launch.completion
        .then((completion) =>
          markDispatchResult({
            runId: run.id,
            status: completion.status,
            ...launchRunTarget,
            precheckResult,
            outputSnapshot: completion.outputSnapshot ?? null,
            error: completion.error ?? null
          })
        )
        .catch((error) =>
          markDispatchResult({
            runId: run.id,
            status: 'dispatch_failed',
            ...launchRunTarget,
            error: error instanceof Error ? error.message : String(error)
          })
        )
    }
    return updated
  } catch (error) {
    return store.updateAutomationRun({
      runId: run.id,
      status: 'dispatch_failed',
      workspaceId: automation.workspaceId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
