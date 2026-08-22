// Stale-while-revalidate decisions for the Plane pane: what the user sees while
// a cached list is on screen and a revalidation runs behind it.

export type PlaneCachedSnapshot<T> = {
  data: T[] | null
  fetchedAt: number
}

export type PlanePaneSeedState<T> = {
  /** null means "keep whatever is on screen" — never blank the pane. */
  seededItems: T[] | null
  seededFetchedAt: number | null
  /** True only when there is nothing to show, i.e. the blocking skeleton. */
  blocking: boolean
}

/**
 * The stale-while-revalidate entry decision for the Plane pane, kept pure so the
 * "no cache means the blocking skeleton comes back" control is a real assertion
 * against the code the pane actually runs.
 *
 * Deliberately ignores TTL: freshness governs whether we REFETCH, never whether
 * we RENDER. An expired snapshot with its age shown beats an empty pane.
 */
export function resolvePlanePaneSeedState<T>(
  entry: PlaneCachedSnapshot<T> | null | undefined
): PlanePaneSeedState<T> {
  if (!entry?.data) {
    return { seededItems: null, seededFetchedAt: null, blocking: true }
  }
  return { seededItems: entry.data, seededFetchedAt: entry.fetchedAt, blocking: false }
}

export type PlanePaneLoadPhase =
  /** Nothing cached to show — the blocking skeleton is the only honest option. */
  | 'cold'
  /** A cached list is on screen while a background revalidation runs. */
  | 'revalidating'
  /** Showing settled, freshly-fetched content. */
  | 'settled'

/**
 * Chooses the load phase for a Plane pane entry. `cold` is what produces the
 * blocking skeleton, so it must be reachable ONLY when there is genuinely
 * nothing cached — that is the whole fix for "cada vez me toca esperar".
 */
export function resolvePlanePaneLoadPhase(args: {
  hasSeed: boolean
  inFlight: boolean
}): PlanePaneLoadPhase {
  if (!args.inFlight) {
    return 'settled'
  }
  return args.hasSeed ? 'revalidating' : 'cold'
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * Human-readable age of the snapshot on screen. Returns null when there is no
 * snapshot, so callers render no timestamp rather than a misleading "just now".
 */
export function formatPlaneSnapshotAge(
  fetchedAt: number | null | undefined,
  now: number
): string | null {
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) {
    return null
  }
  // Clock skew (or a future timestamp) must not render as a negative age.
  const elapsed = Math.max(0, now - fetchedAt)
  if (elapsed < MINUTE_MS) {
    return 'just now'
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m ago`
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h ago`
  }
  return `${Math.floor(elapsed / DAY_MS)}d ago`
}

/**
 * Whether the snapshot on screen is old enough that presenting it without a
 * visible age would misrepresent it as fresh.
 */
export function isPlaneSnapshotStale(
  fetchedAt: number | null | undefined,
  now: number,
  ttlMs: number
): boolean {
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) {
    return false
  }
  return now - fetchedAt >= ttlMs
}
