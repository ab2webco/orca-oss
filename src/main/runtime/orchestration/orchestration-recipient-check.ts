import type { OrchestrationDb } from './db'
import { OrchestrationError } from './orchestration-error'

export type OrchestrationRecipientHandleState =
  | { state: 'live' }
  | { state: 'asleep' }
  | { state: 'closed'; detail: string }
  | { state: 'unknown' }
  // Why: with no renderer graph a leaf handle cannot be resolved either way.
  | { state: 'unverifiable' }

export type OrchestrationRecipientRuntime = {
  describeOrchestrationRecipientHandle(handle: string): OrchestrationRecipientHandleState
}

/** Addresses resolved and refused by their own lookups before point-to-point mail is filed. */
function isResolvedAddress(to: string): boolean {
  return to.startsWith('run:') || to.startsWith('dispatch:') || to.startsWith('@')
}

/**
 * Refuses point-to-point mail no one can read (ORCA-1492). `send --to nobody` answered ok and
 * filed a row for a handle no pane, Dispatch or Run reads, so the lead believed the member was told.
 */
export function assertOrchestrationRecipient(
  runtime: OrchestrationRecipientRuntime,
  db: OrchestrationDb,
  to: string
): void {
  if (isResolvedAddress(to)) {
    return
  }
  const pane = runtime.describeOrchestrationRecipientHandle(to)
  if (pane.state === 'live' || pane.state === 'asleep') {
    return
  }
  // Why: mail to an active Dispatch's assignee handle is read through that Dispatch after a remint,
  // and mail to a Run's coordinator is filed to the Run its Delivery carries.
  if (db.getActiveDispatchForTerminal(to) || db.getRunCoordinatedBy(to)) {
    return
  }
  if (pane.state === 'unverifiable') {
    throw new OrchestrationError(
      'runtime_unavailable',
      `Orca cannot confirm terminal ${to} until its window has loaded. Nothing was queued; retry in a moment.`
    )
  }
  const gone = describeGoneRecipient(db, to, pane)
  if (gone) {
    throw new OrchestrationError(
      'recipient_gone',
      `Terminal ${to} is gone: ${gone}. Nothing was queued; address its Dispatch (dispatch:<id>) or its current terminal.`,
      { recipient: to, found: gone }
    )
  }
  throw new OrchestrationError(
    'recipient_not_found',
    `No terminal, Dispatch or Run here is addressed ${to}. Nothing was queued; use a terminal handle from orca terminal list, dispatch:<id> or run:<id>.`,
    { recipient: to }
  )
}

function describeGoneRecipient(
  db: OrchestrationDb,
  to: string,
  pane: OrchestrationRecipientHandleState
): string | undefined {
  if (pane.state === 'closed') {
    return pane.detail
  }
  const dispatch = db.getLatestDispatchForTerminal(to)
  if (dispatch) {
    return `its Dispatch ${dispatch.id} is ${dispatch.status}`
  }
  return db.hasMessageFromHandle(to) ? 'it sent mail here but no pane holds it now' : undefined
}
