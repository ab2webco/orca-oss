import { ORCHESTRATION_FEDERATION_MEMBER_REOPEN_PROTOCOL_VERSION } from '../../../shared/protocol-version'
import type { OrchestrationDb } from './db'
import { OrchestrationError } from './orchestration-error'
import type { RemoteDispatchAttachmentRow } from './types'

// Why (ORCA-856): a remote member asking after its worker_done reopens that attachment so the
// question reaches the lead's Run; only the holder of its capability can.
export function reopenSettledRemoteAttachmentForAsk(
  db: OrchestrationDb,
  caller: { paneKey: string; capability: string | undefined; processIncarnation: string | null }
): RemoteDispatchAttachmentRow | undefined {
  const settled = db.findLatestSettledRemoteAttachmentForPane(caller.paneKey)
  if (
    !settled ||
    !db.verifySettledRemoteAttachmentAuthority({
      dispatchId: settled.dispatch_id,
      capability: caller.capability,
      paneKey: caller.paneKey,
      processIncarnation: caller.processIncarnation
    })
  ) {
    return undefined
  }
  if (settled.protocol_version < ORCHESTRATION_FEDERATION_MEMBER_REOPEN_PROTOCOL_VERSION) {
    throw new OrchestrationError(
      'dispatch_reopen_unsupported',
      `Your Dispatch ${settled.dispatch_id} on this host already reported and the lead's Orca cannot reopen it. Tell the person in this terminal to ask the lead for a follow-up dispatch, or to update the lead's Orca.`,
      { dispatchId: settled.dispatch_id }
    )
  }
  return db.reopenSettledRemoteAttachment(settled.dispatch_id, 'reopened_by_member_ask')
}
