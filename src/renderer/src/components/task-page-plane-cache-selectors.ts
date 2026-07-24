import type { CacheEntry } from '@/store/slices/github'
import type { PlaneWorkItem } from '../../../shared/plane-types'

type PlaneWorkItemCache = Record<string, CacheEntry<PlaneWorkItem>>
type PlaneWorkItemListCache = Record<string, CacheEntry<PlaneWorkItem[]>>

export type TaskPagePlaneWorkItemLookupOptions = {
  workspaceId?: string | null
}

// Why: Plane cache keys are scoped by workspaceId (not by full task-source
// context, unlike Jira's site-scoped caches — see plane-cache-guards.ts), so
// the lookup filters candidates on workspaceId directly against real store shape.
function matchesLookup(
  item: PlaneWorkItem | null | undefined,
  identifier: string,
  workspaceId: string | null | undefined
): item is PlaneWorkItem {
  if (!item || item.identifier !== identifier) {
    return false
  }
  return !workspaceId || item.workspaceId === workspaceId
}

export function findTaskPagePlaneWorkItem(
  planeWorkItemCache: PlaneWorkItemCache,
  planeSearchCache: PlaneWorkItemListCache,
  planeListCache: PlaneWorkItemListCache,
  identifier: string | null,
  options: TaskPagePlaneWorkItemLookupOptions = {}
): PlaneWorkItem | null {
  if (!identifier) {
    return null
  }

  for (const entry of Object.values(planeWorkItemCache)) {
    if (matchesLookup(entry?.data, identifier, options.workspaceId)) {
      return entry.data
    }
  }

  for (const entry of Object.values(planeSearchCache)) {
    const found = entry?.data?.find((item) => matchesLookup(item, identifier, options.workspaceId))
    if (found) {
      return found
    }
  }

  for (const entry of Object.values(planeListCache)) {
    const found = entry?.data?.find((item) => matchesLookup(item, identifier, options.workspaceId))
    if (found) {
      return found
    }
  }

  return null
}
