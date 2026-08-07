// Why: one home for the heartbeat cadence the preamble teaches, the staleness
// threshold the coordinator warns on, and the first-signal deadline that fails a
// dispatch — they are the same contract and must not drift apart.

// Why: 5 minutes is frequent enough that a hung worker is caught within one
// coordinator tick, and infrequent enough to avoid inbox spam on long tasks
// (Q1 in DESIGN_DOC_PREAMBLE_FIX.md).
export const DISPATCH_HEARTBEAT_INTERVAL_MIN = 5

export const DISPATCH_HEARTBEAT_INTERVAL_MS = DISPATCH_HEARTBEAT_INTERVAL_MIN * 60 * 1000

// Why: one missed heartbeat is the earliest a dispatch can honestly look stale.
export const DISPATCH_STALE_THRESHOLD_MS = DISPATCH_HEARTBEAT_INTERVAL_MS * 2

// Why: an SSH or federated worker's first signal crosses a relay whose import
// cadence is not the worker's; one bounded minute covers that hop without
// turning the deadline into a guess.
export const DISPATCH_FIRST_SIGNAL_TRANSPORT_GRACE_MS = 60 * 1000

// Why (ORCA-191): armed only for capability-bearing injections. A dispatch that
// never produces a lifecycle signal by this point never received its preamble.
export const DISPATCH_FIRST_SIGNAL_DEADLINE_MS =
  DISPATCH_STALE_THRESHOLD_MS + DISPATCH_FIRST_SIGNAL_TRANSPORT_GRACE_MS

// Why: the deadline is minutes wide, so a 30 s scan bounds detection latency
// without polling the DB on a hot loop.
export const ORCHESTRATION_DEADLINE_SCAN_INTERVAL_MS = 30 * 1000

export type DispatchDeadlinePlacement = {
  assigneeHandle: string | null
  assigneePaneKey: string | null
  terminalHandle: string | null
  hostScope: string | null
  environmentName: string | null
}

export function buildDispatchDeadlineFailureReason(params: {
  dispatchId: string
  taskId: string
  placement: DispatchDeadlinePlacement
  deadlineMs: number
}): string {
  const minutes = Math.round(params.deadlineMs / 60000)
  const pane = params.placement.assigneePaneKey ?? '<no stable pane>'
  const terminal =
    params.placement.terminalHandle ?? params.placement.assigneeHandle ?? '<unknown terminal>'
  const host = params.placement.environmentName ?? params.placement.hostScope ?? 'local'
  return (
    `Dispatch ${params.dispatchId} for task ${params.taskId} sent no lifecycle signal within ` +
    `${minutes} min of injection: terminal ${terminal}, pane ${pane}, host ${host}. ` +
    'The preamble was accepted by the PTY but never reached the agent. Orca did not resend it — ' +
    'the submit outcome is ambiguous. Inspect the pane, then retry explicitly.'
  )
}

export function describeDispatchDeadlineSubject(dispatchId: string): string {
  return `Dispatch ${dispatchId} failed: no lifecycle signal`
}
