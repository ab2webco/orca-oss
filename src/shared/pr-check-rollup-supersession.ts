const ACTIONS_RUN_ID = /\/actions\/runs\/(\d+)(?:\/|$)/

type RollupRun = { workflow: string; runId: number; name: string | null }

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
  const name: unknown = Reflect.get(raw, 'name')
  return typeof workflow === 'string' && workflow !== '' && runId !== null
    ? { workflow, runId, name: typeof name === 'string' && name !== '' ? name : null }
    : null
}

const isCancelled = (raw: unknown): boolean =>
  !!raw &&
  typeof raw === 'object' &&
  String(Reflect.get(raw, 'conclusion') ?? '').toLowerCase() === 'cancelled'

/**
 * Keeps only the latest run of each check (ORCA-1269): a newer run of the same workflow and check
 * name on the head replaces it, as in GitHub's own required-check read. A cancelled run superseded
 * by a newer run of its workflow goes whole: its aggregate job can end FAILURE, not CANCELLED.
 * Run ids grow over time, so the larger id is the newer run.
 */
export function latestRunsOfRollup<T>(rollup: readonly T[]): T[] {
  const newest = new Map<string, number>()
  const newestOfCheck = new Map<string, number>()
  const cancelledRuns = new Set<number>()
  const keep = (map: Map<string, number>, key: string, runId: number): void => {
    map.set(key, Math.max(map.get(key) ?? 0, runId))
  }
  for (const raw of rollup) {
    const run = runOf(raw)
    if (!run) {
      continue
    }
    keep(newest, run.workflow, run.runId)
    if (run.name !== null) {
      keep(newestOfCheck, `${run.workflow}\n${run.name}`, run.runId)
    }
    if (isCancelled(raw)) {
      cancelledRuns.add(run.runId)
    }
  }
  return rollup.filter((raw) => {
    const run = runOf(raw)
    if (!run) {
      return true
    }
    if (cancelledRuns.has(run.runId) && run.runId !== newest.get(run.workflow)) {
      return false
    }
    return run.name === null || run.runId === newestOfCheck.get(`${run.workflow}\n${run.name}`)
  })
}
