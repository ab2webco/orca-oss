import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { getOrchestrationMutationExecutor } from '../orchestration-mutation-executor'
import { requiredString } from '../schemas'

const WorkerStartOutcomeParams = z.object({ requestId: requiredString('Missing requestId') })

// Why read-only: a worker-start whose answer was lost must learn its outcome without retrying (ORCA-1398).
export const ORCHESTRATION_WORKER_START_OUTCOME_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.workerStartOutcome',
    params: WorkerStartOutcomeParams,
    handler: (params, { runtime, authenticatedCallerFingerprint }) => {
      const executor = getOrchestrationMutationExecutor(runtime)
      const caller =
        authenticatedCallerFingerprint ?? executor.getLocalAuthenticatedCallerFingerprint()
      return {
        requestId: params.requestId,
        ...executor.workerStartOutcomeOf(caller, params.requestId)
      }
    }
  })
]
