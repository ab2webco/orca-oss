// Why: split out of plane.ts (and its cache-thunk fragments) to keep every
// file under the ~300-line cap — these are pure generation/freshness/key
// helpers with no zustand dependency, so they're independently unit-testable.
import type {
  PlaneConnectionStatus,
  PlaneWorkItemFilter,
  PlaneWorkspaceSelection
} from '../../../../shared/plane-types'
import type { CacheEntry } from './github'

export function getSelectedPlaneWorkspaceId(
  status: PlaneConnectionStatus
): PlaneWorkspaceSelection | null {
  return status.selectedWorkspaceId ?? status.activeWorkspaceId ?? null
}

export function looksLikePlaneAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /authenticat|unauthorized|401/i.test(msg)
}

// Plane's PAT budget is 60 req/min (vs GitHub/Linear's tighter per-second
// budgets), so a longer TTL trades a bit of staleness for fewer calls.
export const PLANE_CACHE_TTL = 120_000
export const PLANE_MAX_CACHE_ENTRIES = 500

let planeMutationGeneration = 0
let planeCacheGeneration = 0

export function currentPlaneMutationGeneration(): number {
  return planeMutationGeneration
}

export function currentPlaneCacheGeneration(): number {
  return planeCacheGeneration
}

/** Bumps and returns the new mutation generation; any in-flight read captured
 *  against an older generation must not be allowed to write its result. */
export function beginPlaneMutation(): number {
  planeMutationGeneration += 1
  return planeMutationGeneration
}

/** Bumps and returns the new cache generation, invalidating every previously
 *  cached read (e.g. after connect/disconnect/workspace switch). */
export function bumpPlaneCacheGeneration(): number {
  planeCacheGeneration += 1
  return planeCacheGeneration
}

export function resetPlaneGenerationsForTests(): void {
  planeMutationGeneration = 0
  planeCacheGeneration = 0
}

export function isFreshPlaneCacheEntry<T>(
  entry: CacheEntry<T> | undefined,
  ttl = PLANE_CACHE_TTL
): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() - entry.fetchedAt < ttl
}

export function evictStalePlaneCacheEntries<T>(
  cache: Record<string, CacheEntry<T>>,
  maxEntries = PLANE_MAX_CACHE_ENTRIES
): Record<string, CacheEntry<T>> {
  const keys = Object.keys(cache)
  if (keys.length <= maxEntries) {
    return cache
  }
  const sorted = keys.sort((a, b) => (cache[a]?.fetchedAt ?? 0) - (cache[b]?.fetchedAt ?? 0))
  const pruned: Record<string, CacheEntry<T>> = {}
  for (const key of sorted.slice(sorted.length - maxEntries)) {
    pruned[key] = cache[key]
  }
  return pruned
}

/** Gates every Plane cache write: a request captured before a workspace/context
 *  switch or mutation (superseded generation) must never overwrite fresher
 *  state once it resolves late. */
export function canWritePlaneReadResult(
  requestContextKey: string,
  currentContextKey: string,
  requestCacheGeneration: number,
  requestMutationGeneration: number
): boolean {
  return (
    requestContextKey === currentContextKey &&
    requestCacheGeneration === planeCacheGeneration &&
    requestMutationGeneration === planeMutationGeneration
  )
}

export function planeWorkItemCacheKey(
  workspaceId: PlaneWorkspaceSelection | null | undefined,
  workItemId: string
): string {
  return `${workspaceId ?? 'default'}::item::${workItemId}`
}

export function planeSearchCacheKey(
  workspaceId: PlaneWorkspaceSelection | null | undefined,
  projectId: string | undefined,
  query: string
): string {
  return `${workspaceId ?? 'default'}::search::${projectId ?? 'all'}::${query}`
}

export function planeListCacheKey(
  workspaceId: PlaneWorkspaceSelection | null | undefined,
  mode: string,
  ...parts: (string | undefined)[]
): string {
  return [workspaceId ?? 'default', mode, ...parts.map((part) => part ?? '')].join('::')
}

export function planeWorkItemListCacheKey(
  workspaceId: PlaneWorkspaceSelection | null | undefined,
  filter: PlaneWorkItemFilter,
  projectId: string | undefined
): string {
  return planeListCacheKey(workspaceId, 'workItems', filter, projectId)
}

export function planeProjectCacheKey(
  workspaceId: PlaneWorkspaceSelection | null | undefined
): string {
  return `${workspaceId ?? 'default'}::projects`
}
