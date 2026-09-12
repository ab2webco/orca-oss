import type { PlaneWorkItem } from '../../../../shared/plane-types'
import type { CacheEntry } from './github'

// Why localStorage and not the store: the in-memory cache dies with the
// renderer, so every app launch paid the full fan-out again (ORCA-492 — 10,9 s
// for one project, a 30 s timeout for every project). This survives the launch
// so the pane paints the last list while the refetch runs behind it.
const STORAGE_KEY = 'orca.plane.work-item-list.v1'
const SCHEMA_VERSION = 1

/** Keeps a handful of recent scopes (preset × project) without unbounded growth. */
const MAX_ENTRIES = 8
/** UTF-16 units, the unit the ~5 MB origin quota is counted in: stays well under
 *  it so a big snapshot can't push other keys out. */
const MAX_PAYLOAD_CHARS = 2_000_000

type PersistedListEntry = {
  fetchedAt: number
  items: PlaneWorkItem[]
}

type PersistedSnapshotFile = {
  version: number
  /** Runtime scope (local vs. a named environment); a snapshot never crosses it. */
  scopeKey: string
  entries: Record<string, PersistedListEntry>
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isPlaneWorkItem(value: unknown): value is PlaneWorkItem {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const item = value as Record<string, unknown>
  const project = item.project as Record<string, unknown> | undefined
  const state = item.state as Record<string, unknown> | undefined
  return (
    typeof item.id === 'string' &&
    typeof item.identifier === 'string' &&
    typeof item.title === 'string' &&
    typeof item.url === 'string' &&
    typeof item.updatedAt === 'string' &&
    typeof item.createdAt === 'string' &&
    Array.isArray(item.labels) &&
    typeof project?.id === 'string' &&
    typeof state?.id === 'string' &&
    typeof state?.group === 'string'
  )
}

function parseEntry(value: unknown): PersistedListEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const entry = value as Record<string, unknown>
  if (typeof entry.fetchedAt !== 'number' || !Number.isFinite(entry.fetchedAt)) {
    return null
  }
  if (!Array.isArray(entry.items) || !entry.items.every(isPlaneWorkItem)) {
    return null
  }
  return { fetchedAt: entry.fetchedAt, items: entry.items }
}

function readFile(scopeKey: string): PersistedSnapshotFile | null {
  const store = storage()
  if (!store) {
    return null
  }
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed?.version !== SCHEMA_VERSION || parsed.scopeKey !== scopeKey) {
      return null
    }
    const rawEntries = parsed.entries
    if (typeof rawEntries !== 'object' || rawEntries === null) {
      return null
    }
    const entries: Record<string, PersistedListEntry> = {}
    for (const [key, value] of Object.entries(rawEntries as Record<string, unknown>)) {
      const entry = parseEntry(value)
      if (entry) {
        entries[key] = entry
      }
    }
    return { version: SCHEMA_VERSION, scopeKey, entries }
  } catch {
    return null
  }
}

/** Drops the oldest scopes until the payload fits both bounds; null when even
 *  the newest entry alone is too big to store. */
function serializeWithinBounds(file: PersistedSnapshotFile): string | null {
  const byAge = Object.entries(file.entries).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
  let kept = byAge.slice(0, MAX_ENTRIES)
  while (kept.length > 0) {
    const payload = JSON.stringify({
      version: SCHEMA_VERSION,
      scopeKey: file.scopeKey,
      entries: Object.fromEntries(kept)
    })
    if (payload.length <= MAX_PAYLOAD_CHARS) {
      return payload
    }
    kept = kept.slice(0, -1)
  }
  return null
}

export function readPlaneListSnapshot(
  scopeKey: string,
  cacheKey: string
): CacheEntry<PlaneWorkItem[]> | null {
  const entry = readFile(scopeKey)?.entries[cacheKey]
  return entry ? { data: entry.items, fetchedAt: entry.fetchedAt } : null
}

export function writePlaneListSnapshot(
  scopeKey: string,
  cacheKey: string,
  entry: CacheEntry<PlaneWorkItem[]>
): void {
  const store = storage()
  if (!store || !entry.data) {
    return
  }
  const current = readFile(scopeKey)?.entries ?? {}
  const payload = serializeWithinBounds({
    version: SCHEMA_VERSION,
    scopeKey,
    entries: { ...current, [cacheKey]: { fetchedAt: entry.fetchedAt, items: entry.data } }
  })
  try {
    if (payload === null) {
      store.removeItem(STORAGE_KEY)
      return
    }
    store.setItem(STORAGE_KEY, payload)
  } catch {
    // A full or unavailable quota must not break the list that just loaded.
  }
}

export function clearPlaneListSnapshots(): void {
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do: the snapshot is a cache, not state anyone can lose.
  }
}
