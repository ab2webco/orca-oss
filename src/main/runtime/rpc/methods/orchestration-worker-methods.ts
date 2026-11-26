import type { RpcMethod } from '../core'
import { ORCHESTRATION_WORKER_CONTROL_METHODS } from './orchestration-worker-control'
import { ORCHESTRATION_WORKER_RELEASE_METHODS } from './orchestration-worker-release'
import { ORCHESTRATION_WORKER_START_OUTCOME_METHODS } from './orchestration-worker-start-outcome'
import { ORCHESTRATION_WORKER_STOP_METHODS } from './orchestration-worker-stop'
import { ORCHESTRATION_WORKER_START_METHODS } from './orchestration-workers'

// Why these alone: each adds or removes a member, and a list or a keystroke must not wake every band.
const FLEET_CHANGING_METHODS = new Set([
  'orchestration.workerStart',
  'orchestration.workerStop',
  'orchestration.workerDetach',
  'orchestration.workerRelease'
])

// Why settled either way: the open Team panel re-reads on a fleet change (ORCA-1441), and a start
// into an existing worktree bumps nothing else, refused or not.
const notingFleetChange = (method: RpcMethod): RpcMethod =>
  FLEET_CHANGING_METHODS.has(method.name)
    ? {
        ...method,
        handler: async (params, ctx) => {
          try {
            return await method.handler(params, ctx)
          } finally {
            ctx.runtime.noteGameFleetChanged?.()
          }
        }
      }
    : method

export const ORCHESTRATION_WORKER_METHODS: RpcMethod[] = [
  ...ORCHESTRATION_WORKER_START_METHODS,
  ...ORCHESTRATION_WORKER_START_OUTCOME_METHODS,
  ...ORCHESTRATION_WORKER_CONTROL_METHODS,
  ...ORCHESTRATION_WORKER_STOP_METHODS,
  ...ORCHESTRATION_WORKER_RELEASE_METHODS
].map(notingFleetChange)
