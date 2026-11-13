import { ticketOfMember } from '../../../../shared/orchestrator-game-fleet-verbs'
import type { GameAgent } from '../../../../shared/orchestrator-game-state'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { releaseFederatedWorker } from './orchestration-federated-worker-release'

type LeadCaller = { worktreeId?: string; terminalHandle?: string }

// Why a backoff: a host that keeps refusing or not answering must not be asked on every state read.
const MAX_BACKOFF_STEPS = 4
const failuresByRuntime = new WeakMap<OrcaRuntimeService, Map<string, number>>()

const failuresOf = (runtime: OrcaRuntimeService): Map<string, number> => {
  const failures = failuresByRuntime.get(runtime) ?? new Map<string, number>()
  failuresByRuntime.set(runtime, failures)
  return failures
}

/** How long to wait before asking the host again: the base interval, doubled per failed try. */
export function retainedReleaseIntervalMs(
  runtime: OrcaRuntimeService,
  dispatchId: string,
  baseMs: number
): number {
  return baseMs * 2 ** Math.min(failuresOf(runtime).get(dispatchId) ?? 0, MAX_BACKOFF_STEPS)
}

/**
 * Finishes a release the lead asked for and its host retained, now that the member's terminal is
 * gone. The host decides by its own rules, through the same release call any host already knows.
 */
export async function finishRequestedRelease(
  runtime: OrcaRuntimeService,
  dispatchId: string,
  agent: GameAgent,
  caller: LeadCaller
): Promise<void> {
  const federated = runtime.getOrchestrationDb().getFederatedDispatch(dispatchId)
  if (!federated) {
    return
  }
  const failures = failuresOf(runtime)
  const receipt = await releaseFederatedWorker({ runtime, federated, requestId: undefined }).catch(
    () => null
  )
  if (receipt?.state !== 'released' && receipt?.state !== 'already_released') {
    failures.set(dispatchId, (failures.get(dispatchId) ?? 0) + 1)
    return
  }
  failures.delete(dispatchId)
  await runtime
    .getGameBoard()
    .postEvent({
      ...caller,
      kind: 'stopped',
      ticket: ticketOfMember(agent) ?? undefined,
      text: `Released: its terminal on ${agent.remote?.host ?? federated.environment_name} closed after you asked to release it.`,
      key: `retained-release:${dispatchId}`
    })
    .catch(() => undefined)
}
