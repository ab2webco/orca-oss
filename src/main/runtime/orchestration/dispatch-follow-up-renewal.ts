import type { OrchestrationDb } from './db'
import type { DispatchContextRow } from './types'

// Why (ORCA-779): a lead's follow-up prompt to a member that already reported
// reopens its completed Dispatch, so the next worker_done is not rejected for a
// revoked capability. Failed and active Dispatches are left to their own paths.
export function renewDispatchForFollowUpPrompt(
  db: OrchestrationDb,
  target: { handle: string; paneKey: string | undefined }
): DispatchContextRow | undefined {
  const latest = db.getLatestDispatchForIdentity(target.handle, target.paneKey)
  if (latest?.status !== 'completed') {
    return undefined
  }
  return db.renewCompletedDispatch({
    dispatchId: latest.id,
    reason: 'Renewed by a follow-up prompt from the lead.'
  })
}

// Why (ORCA-856): a member asking after its worker_done reopens that Dispatch so
// the question reaches the lead; only the holder of its capability can.
export function renewDispatchForMemberAsk(
  db: OrchestrationDb,
  caller: {
    handle: string
    paneKey: string | undefined
    capability: string | undefined
    processIncarnation: string | undefined
  }
): DispatchContextRow | undefined {
  const latest = db.getLatestDispatchForIdentity(caller.handle, caller.paneKey)
  if (latest?.status !== 'completed') {
    return undefined
  }
  const authority = db.verifyDispatchCapability({
    dispatchId: latest.id,
    capability: caller.capability,
    paneKey: caller.paneKey,
    processIncarnation: caller.processIncarnation,
    acceptRevoked: true
  })
  if (!authority.valid) {
    return undefined
  }
  return db.renewCompletedDispatch({
    dispatchId: latest.id,
    reason: 'Renewed by a question from its member after worker_done.'
  })
}
