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
