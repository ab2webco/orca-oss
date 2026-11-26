import { z } from 'zod'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { defineMethod, type RpcMethod } from '../core'
import { requiredString } from '../schemas'
import { detachFederatedWorker } from './orchestration-federated-worker-detach'
import { stopFederatedWorker } from './orchestration-federated-worker-stop'
import { inspectWorkerTerminal } from './orchestration-worker-observation'
import { settledReceipt, unknownReceipt } from './orchestration-worker-stop-receipt'

const WorkerDispatchParams = z.object({ dispatch: requiredString('Missing --dispatch') })

export const ORCHESTRATION_WORKER_STOP_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.workerDetach',
    params: WorkerDispatchParams,
    handler: async (params, { runtime, orchestrationMutation }) => {
      const db = runtime.getOrchestrationDb()
      const federated = db.getFederatedDispatch(params.dispatch)
      if (federated) {
        return await detachFederatedWorker({
          runtime,
          federated,
          requestId: orchestrationMutation?.requestId
        })
      }
      const detached = db.detachWorker(params.dispatch)
      if (detached.disposition === 'detached') {
        runtime.notifyMessageArrived(`dispatch:${params.dispatch}`, 'status')
      }
      return {
        dispatchId: params.dispatch,
        state: detached.worker.state,
        alreadySettled: detached.disposition === 'already_settled',
        processAction: 'none' as const
      }
    }
  }),
  defineMethod({
    name: 'orchestration.workerStop',
    params: WorkerDispatchParams,
    handler: async (params, { runtime, orchestrationMutation }) => {
      const db = runtime.getOrchestrationDb()
      const federated = db.getFederatedDispatch(params.dispatch)
      if (federated) {
        if (!orchestrationMutation) {
          throw new OrchestrationError(
            'invalid_argument',
            'Remote worker-stop requires a durable retry request.'
          )
        }
        return await stopFederatedWorker({
          runtime,
          federated,
          requestId: orchestrationMutation.requestId
        })
      }

      const begun = db.beginWorkerStop(params.dispatch)
      if (begun.disposition === 'already_settled') {
        return settledReceipt(params.dispatch, begun.worker.state)
      }
      if (begun.disposition === 'context_only') {
        if (!begun.alreadySettled) {
          runtime.notifyMessageArrived(`dispatch:${params.dispatch}`, 'status')
        }
        return {
          dispatchId: params.dispatch,
          state: begun.state,
          alreadySettled: begun.alreadySettled,
          processAction: 'none' as const,
          warning: contextOnlyStopWarning(begun)
        }
      }
      const handle = begun.worker.agent_terminal_handle
      if (!handle) {
        return unknownReceipt(
          params.dispatch,
          db.markWorkerStopUnknown(params.dispatch, 'The Dispatch has no recorded agent terminal.'),
          'unknown'
        )
      }
      const observation = await inspectWorkerTerminal(runtime, db, params.dispatch)
      if (!observation.exact || observation.status !== 'running') {
        return unknownReceipt(
          params.dispatch,
          db.markWorkerStopUnknown(
            params.dispatch,
            `The recorded worker process is ${observation.status}; no terminal was closed.`
          ),
          'none'
        )
      }
      try {
        const close = await runtime.closeTerminal(handle)
        const worker = db.settleWorkerStop(params.dispatch)
        runtime.notifyMessageArrived(`dispatch:${params.dispatch}`, 'status')
        return {
          dispatchId: params.dispatch,
          state: worker.state,
          alreadySettled: false,
          processAction: 'closed_agent_terminal',
          close
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return unknownReceipt(
          params.dispatch,
          db.markWorkerStopUnknown(params.dispatch, reason),
          'unknown'
        )
      }
    }
  })
]

function contextOnlyStopWarning(result: {
  state: string
  alreadySettled: boolean
  releasedCurrentTask: boolean
}): string {
  if (result.alreadySettled) {
    return `Dispatch was already ${result.state}; no terminal process changed.`
  }
  return result.releasedCurrentTask
    ? 'The assignment was stopped without closing its unsupervised terminal process.'
    : 'The superseded assignment was stopped without changing the current Task or terminal process.'
}
