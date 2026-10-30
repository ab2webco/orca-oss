import { ORCHESTRATION_FEDERATION_FOLLOW_UP_PROTOCOL_VERSION } from '../../../shared/protocol-version'
import type { OrchestrationDb } from './db'
import { OrchestrationError } from './orchestration-error'
import type { FederatedDispatchRow } from './types'

export const FEDERATED_FOLLOW_UP_RELAY_KIND = 'follow_up'

export type FederatedMailRoute =
  | { kind: 'control_message' }
  | { kind: typeof FEDERATED_FOLLOW_UP_RELAY_KIND; reopenSettledReason: string; note: string }

// Why (ORCA-838): mail to a settled remote member reopens its Dispatch, so the Panel tracks the
// follow-up and the host's push-on-idle hands it to the busy agent on its next turn.
export function routeFederatedMail(
  db: OrchestrationDb,
  federated: FederatedDispatchRow
): FederatedMailRoute {
  const dispatchId = federated.dispatch_id
  const worker = db.getWorkerDispatch(dispatchId)
  if (worker?.state === 'ready') {
    return { kind: 'control_message' }
  }
  const host = federated.environment_name
  if (worker?.stage === 'released') {
    throw new OrchestrationError(
      'dispatch_inactive',
      `Federated Dispatch ${dispatchId} was released on ${host}; start a new one with \`orca orchestration worker-start --on ${host}\`.`
    )
  }
  if (!db.isReopenableFederatedDispatch(dispatchId)) {
    throw new OrchestrationError(
      'dispatch_inactive',
      `Federated Dispatch ${dispatchId} is not active and cannot take a follow-up; start a new one with \`orca orchestration worker-start --on ${host}\`.`
    )
  }
  if (federated.protocol_version < ORCHESTRATION_FEDERATION_FOLLOW_UP_PROTOCOL_VERSION) {
    const placement =
      federated.remote_worktree_id && federated.remote_terminal_handle
        ? ` --worktree id:${federated.remote_worktree_id} --terminal ${federated.remote_terminal_handle}`
        : ''
    throw new OrchestrationError(
      'dispatch_inactive',
      `Federated Dispatch ${dispatchId} already reported and its host ${host} cannot reopen it for a follow-up. Once its agent is idle, start a new Dispatch with \`orca orchestration worker-start --on ${host}${placement}\`, or update Orca on ${host}.`
    )
  }
  const taskId = db.getDispatchContextById(dispatchId)?.task_id
  return {
    kind: FEDERATED_FOLLOW_UP_RELAY_KIND,
    reopenSettledReason: 'Reopened by a follow-up from its lead after worker_done.',
    note: `Follow-up from your lead: Dispatch ${dispatchId} is open again. When this is done, send worker_done again with --task-id ${taskId} --dispatch-id ${dispatchId}.`
  }
}
