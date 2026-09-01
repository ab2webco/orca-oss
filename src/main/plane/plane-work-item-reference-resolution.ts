// Client-side resolution of the bare state/label/assignee UUIDs that list
// rows carry now that listQuery sends no `expand`: Plane resolves expand per
// row server-side, so list latency grew with item count (ORCA-333). The three
// per-project reference lists are O(1) in item count and cached here.
import type { PlaneClientForWorkspace } from './client'
import {
  listLabelsForClient,
  listProjectMembersForClient,
  listWorkspaceMembersForClient,
  listStatesForClient
} from './plane-work-item-reads'
import type { PlaneState, PlaneUser } from '../../shared/plane-types'

type PlaneRecord = Record<string, unknown>

export type PlaneWorkItemReferenceMaps = {
  statesById: ReadonlyMap<string, PlaneState>
  labelNamesById: ReadonlyMap<string, string>
  usersById: ReadonlyMap<string, PlaneUser>
}

const REFERENCE_TTL_MS = 5 * 60_000
// An id the server just told us does not exist will not appear on a refetch;
// this floor keeps a permanently-unresolvable id from refetching every list.
const UNKNOWN_ID_REFETCH_FLOOR_MS = 15_000

type CacheEntry<V> = { byId: Map<string, V>; fetchedAt: number }

const stateCache = new Map<string, CacheEntry<PlaneState>>()
const labelCache = new Map<string, CacheEntry<string>>()
const memberCache = new Map<string, CacheEntry<PlaneUser>>()

// Test-only: the caches are module state and would leak across vitest cases.
export function clearWorkItemReferenceCachesForTest(): void {
  stateCache.clear()
  labelCache.clear()
  memberCache.clear()
}

function cacheKey(client: PlaneClientForWorkspace, projectId: string): string {
  // Workspace identity is (baseUrl, slug): two workspaces can share a slug.
  return `${client.baseUrl}\n${client.workspaceSlug}\n${projectId}`
}

function collectBareIds(raws: readonly PlaneRecord[]): {
  stateIds: Set<string>
  labelIds: Set<string>
  assigneeIds: Set<string>
} {
  const stateIds = new Set<string>()
  const labelIds = new Set<string>()
  const assigneeIds = new Set<string>()
  for (const raw of raws) {
    if (typeof raw.state === 'string' && raw.state) {
      stateIds.add(raw.state)
    }
    for (const entry of Array.isArray(raw.labels) ? raw.labels : []) {
      if (typeof entry === 'string' && entry) {
        labelIds.add(entry)
      }
    }
    for (const entry of Array.isArray(raw.assignees) ? raw.assignees : []) {
      if (typeof entry === 'string' && entry) {
        assigneeIds.add(entry)
      }
    }
  }
  return { stateIds, labelIds, assigneeIds }
}

async function resolveKind<V>(
  cache: Map<string, CacheEntry<V>>,
  key: string,
  neededIds: ReadonlySet<string>,
  fetchById: () => Promise<Map<string, V>>
): Promise<ReadonlyMap<string, V>> {
  if (neededIds.size === 0) {
    return new Map()
  }
  const entry = cache.get(key)
  if (entry) {
    const age = Date.now() - entry.fetchedAt
    const covers = [...neededIds].every((id) => entry.byId.has(id))
    if (age < REFERENCE_TTL_MS && (covers || age < UNKNOWN_ID_REFETCH_FLOOR_MS)) {
      return entry.byId
    }
  }
  const byId = await fetchById()
  cache.set(key, { byId, fetchedAt: Date.now() })
  return byId
}

async function fetchMembersById(
  client: PlaneClientForWorkspace,
  projectId: string,
  neededIds: ReadonlySet<string>
): Promise<Map<string, PlaneUser>> {
  const byId = new Map<string, PlaneUser>()
  for (const member of await listProjectMembersForClient(client, projectId)) {
    byId.set(member.id, member)
  }
  // An assignee no longer in the project (or an empty project-members read)
  // still resolves via workspace members; project entries win on conflict.
  if (![...neededIds].every((id) => byId.has(id))) {
    for (const member of await listWorkspaceMembersForClient(client)) {
      if (!byId.has(member.id)) {
        byId.set(member.id, member)
      }
    }
  }
  return byId
}

// No acquire()/release() here: callers already hold the concurrency gate for
// the whole per-client load, and a nested acquire can deadlock at MAX_CONCURRENT.
export async function resolveWorkItemReferences(
  client: PlaneClientForWorkspace,
  projectId: string,
  raws: readonly PlaneRecord[]
): Promise<PlaneWorkItemReferenceMaps> {
  const { stateIds, labelIds, assigneeIds } = collectBareIds(raws)
  const key = cacheKey(client, projectId)
  const [statesById, labelNamesById, usersById] = await Promise.all([
    resolveKind(stateCache, key, stateIds, async () => {
      const byId = new Map<string, PlaneState>()
      for (const state of await listStatesForClient(client, projectId)) {
        byId.set(state.id, state)
      }
      return byId
    }),
    resolveKind(labelCache, key, labelIds, async () => {
      const byId = new Map<string, string>()
      for (const label of await listLabelsForClient(client, projectId)) {
        byId.set(label.id, label.name)
      }
      return byId
    }),
    resolveKind(memberCache, key, assigneeIds, () =>
      fetchMembersById(client, projectId, assigneeIds)
    )
  ])
  return { statesById, labelNamesById, usersById }
}
