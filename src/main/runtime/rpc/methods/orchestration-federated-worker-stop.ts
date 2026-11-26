import { ORCHESTRATION_FEDERATION_STOP_ASLEEP_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { FederatedDispatchRow } from '../../orchestration/types'
import { isHostDispatchNotFound } from './orchestration-federated-worker-gone'
import { resolvePinnedFederatedServer } from './orchestration-worker-observation'
import { settledReceipt, unknownReceipt } from './orchestration-worker-stop-receipt'

type RemoteStopReceipt = {
  state: string
  alreadySettled: boolean
  processAction: string
  close?: unknown
  lastError?: string | null
}

/** Stops a remote member on its paired host; a stop_unknown one is retried only on a host that can. */
export async function stopFederatedWorker(args: {
  runtime: OrcaRuntimeService
  federated: FederatedDispatchRow
  requestId: string | undefined
}) {
  const { runtime, federated } = args
  const dispatchId = federated.dispatch_id
  const db = runtime.getOrchestrationDb()
  const server = resolvePinnedFederatedServer(runtime, federated)
  const retryStopUnknown = db.getWorkerDispatch(dispatchId)?.state === 'stop_unknown'
  if (retryStopUnknown) {
    await requireStopRetryOnHost(runtime, server)
  }
  const begun = db.beginWorkerStop(dispatchId, { retryStopUnknown })
  if (begun.disposition === 'already_settled') {
    return settledReceipt(dispatchId, begun.worker.state)
  }
  try {
    const remote = (await runtime.callOrchestrationWorkerServer(
      server.environmentId,
      'orchestration.federationStop',
      { dispatchId },
      30_000,
      args.requestId ? { orchestrationRequestId: args.requestId } : undefined
    )) as RemoteStopReceipt
    if (remote.state === 'stopped') {
      const worker = db.reconcileFederatedWorkerStop(dispatchId)
      return {
        dispatchId,
        state: worker.state,
        alreadySettled: remote.alreadySettled,
        processAction: remote.processAction,
        close: remote.close
      }
    }
    if (remote.state === 'succeeded' || remote.state === 'failed') {
      db.resumeFederatedWorkerForTerminalRelay(dispatchId)
      await runtime
        .syncOrchestrationFederatedDispatchAfterCurrent(dispatchId)
        .catch(() => undefined)
      return {
        dispatchId,
        state: db.getWorkerDispatch(dispatchId)?.state ?? remote.state,
        alreadySettled: true,
        processAction: 'none'
      }
    }
    return unknownReceipt(
      dispatchId,
      db.markWorkerStopUnknown(
        dispatchId,
        remote.lastError ?? `The worker server returned ${remote.state}.`
      ),
      remote.processAction
    )
  } catch (error) {
    // Why: the host holds nothing of it for this home, so no stop there can ever be proven (ORCA-864).
    if (isHostDispatchNotFound(error)) {
      const worker = db.reconcileFederatedWorkerStop(dispatchId)
      return {
        dispatchId,
        state: worker.state,
        alreadySettled: false,
        processAction: 'none',
        warning: `${server.name} has no record of this member for this Orca; nothing was closed there.`
      }
    }
    const reason = error instanceof Error ? error.message : String(error)
    return unknownReceipt(dispatchId, db.markWorkerStopUnknown(dispatchId, reason), 'unknown')
  }
}

// Why ask first: an older host refuses a stop from stop_unknown and never closes an asleep pane.
async function requireStopRetryOnHost(
  runtime: OrcaRuntimeService,
  server: { environmentId: string; name: string }
): Promise<void> {
  const status = (await runtime.callOrchestrationWorkerServer(
    server.environmentId,
    'status.get',
    undefined,
    15_000
  )) as RuntimeStatus
  if (!status.capabilities?.includes(ORCHESTRATION_FEDERATION_STOP_ASLEEP_RUNTIME_CAPABILITY)) {
    throw new OrchestrationError(
      'capability_unsupported',
      `${server.name} runs Orca ${status.appVersion ?? '(version unknown)'}, which cannot retry a stop it could not prove (${ORCHESTRATION_FEDERATION_STOP_ASLEEP_RUNTIME_CAPABILITY}); update Orca on ${server.name}, or close the member's terminal there. No effects were applied.`,
      { capability: ORCHESTRATION_FEDERATION_STOP_ASLEEP_RUNTIME_CAPABILITY, host: server.name }
    )
  }
}
