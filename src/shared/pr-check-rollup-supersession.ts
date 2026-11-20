const ACTIONS_RUN_ID = /\/actions\/runs\/(\d+)(?:\/|$)/

type RollupRun = { workflow: string; runId: number }

function runOf(raw: unknown): RollupRun | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const workflow: unknown = Reflect.get(raw, 'workflowName')
  // Why: a gh rollup entry carries detailsUrl; a normalized PRCheckDetail carries workflowRunId.
  const id: unknown = Reflect.get(raw, 'workflowRunId')
  const url: unknown = Reflect.get(raw, 'detailsUrl')
  const match = typeof url === 'string' ? ACTIONS_RUN_ID.exec(url) : null
  const runId = typeof id === 'number' ? id : match ? Number(match[1]) : null
  return typeof workflow === 'string' && workflow !== '' && runId !== null
    ? { workflow, runId }
    : null
}

const isCancelled = (raw: unknown): boolean =>
  !!raw &&
  typeof raw === 'object' &&
  String(Reflect.get(raw, 'conclusion') ?? '').toLowerCase() === 'cancelled'

/**
 * Drops every entry of a cancelled Actions run once a newer run of the same workflow is on the head
 * (ORCA-1269). Its aggregate job can end FAILURE, not CANCELLED, so the whole run goes, not one check.
 * Run ids grow over time, so the larger id is the newer run.
 */
export function withoutSupersededCancelledRuns<T>(rollup: readonly T[]): T[] {
  const newest = new Map<string, number>()
  const cancelledRuns = new Set<number>()
  for (const raw of rollup) {
    const run = runOf(raw)
    if (!run) {
      continue
    }
    newest.set(run.workflow, Math.max(newest.get(run.workflow) ?? 0, run.runId))
    if (isCancelled(raw)) {
      cancelledRuns.add(run.runId)
    }
  }
  return rollup.filter((raw) => {
    const run = runOf(raw)
    return !run || !cancelledRuns.has(run.runId) || run.runId === newest.get(run.workflow)
  })
}
