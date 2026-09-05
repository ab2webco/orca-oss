import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { SendRequestOptions } from '../transport/rpc-client'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'

export type PlaneWriteFailure = {
  ok: false
  error: string
  /** The request left the phone but no reply came back: Plane may have applied it. */
  deliveryUnknown?: true
}

// Why: the client's 30s clock only starts after connect and the connect wait has no
// ceiling of its own, so a dropped socket would park the sheet on "Creating…" for good.
export const PLANE_WRITE_TIMEOUT_MS = 15_000

export const PLANE_WRITE_REQUEST_OPTIONS: SendRequestOptions = {
  timeoutMs: PLANE_WRITE_TIMEOUT_MS,
  budgetSpansConnect: true
}

export const PLANE_WRITE_UNANSWERED_MESSAGE =
  'The host did not answer in time. Check the board before trying again.'

const UNREACHABLE_MESSAGE = 'The write did not reach the host'

export function describePlaneWriteRejection(error: unknown): PlaneWriteFailure {
  if (isRpcDeliveryUnknown(error)) {
    return { ok: false, error: PLANE_WRITE_UNANSWERED_MESSAGE, deliveryUnknown: true }
  }
  return {
    ok: false,
    error: error instanceof Error && error.message ? error.message : UNREACHABLE_MESSAGE
  }
}

/** After an unanswered create, a re-read that shows a new card with the asked title
 *  in the asked column is the success whose reply got lost; retrying blind would
 *  create it twice. */
export function unansweredPlaneCreateLanded(
  items: readonly PlaneMobileWorkItem[],
  knownIds: ReadonlySet<string>,
  stateId: string,
  title: string
): boolean {
  return items.some(
    (item) => !knownIds.has(item.id) && item.state.id === stateId && item.title === title
  )
}
