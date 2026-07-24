import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { PlaneWorkItem, PlaneWorkItemFilter } from '../../../../shared/plane-types'
import type { CacheEntry } from './github'
import { isIntegrationCredentialDecryptionError } from '../../../../shared/integration-credential-errors'
import { planeListWorkItems, planeSearchWorkItems } from '@/runtime/runtime-plane-client'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  bumpPlaneCacheGeneration,
  canWritePlaneReadResult,
  currentPlaneCacheGeneration,
  currentPlaneMutationGeneration,
  evictStalePlaneCacheEntries,
  getSelectedPlaneWorkspaceId,
  isFreshPlaneCacheEntry,
  looksLikePlaneAuthError,
  planeSearchCacheKey,
  planeWorkItemListCacheKey
} from './plane-cache-guards'

type InflightPlaneListRead = {
  promise: Promise<PlaneWorkItem[]>
  contextKey: string
  mutationGeneration: number
  force?: boolean
}

const inflightSearchRequests = new Map<string, InflightPlaneListRead>()
const inflightListRequests = new Map<string, InflightPlaneListRead>()

const PLANE_LIST_INVALIDATION_VERSION_CAP = 10_000
let planeListInvalidationToken: { scope: string; version: number } = { scope: '', version: 0 }

export type PlaneWorkItemReadArgs =
  | { kind: 'search'; query: string; projectId?: string }
  | { kind: 'list'; filter?: PlaneWorkItemFilter; projectId?: string }

export type PlaneFetchOptions = { force?: boolean }

export type PlaneWorkItemListSlice = {
  planeSearchCache: Record<string, CacheEntry<PlaneWorkItem[]>>
  planeListCache: Record<string, CacheEntry<PlaneWorkItem[]>>
  planeListInvalidationToken: { scope: string; version: number }

  getCachedPlaneWorkItems: (args: PlaneWorkItemReadArgs) => PlaneWorkItem[] | null
  searchPlaneWorkItems: (
    query: string,
    projectId?: string,
    workspaceId?: string | null,
    options?: PlaneFetchOptions
  ) => Promise<PlaneWorkItem[]>
  listPlaneWorkItems: (
    filter?: PlaneWorkItemFilter,
    projectId?: string,
    workspaceId?: string | null,
    options?: PlaneFetchOptions
  ) => Promise<PlaneWorkItem[]>
  invalidatePlaneWorkItemLists: () => void
}

export const createPlaneWorkItemListSlice: StateCreator<
  AppState,
  [],
  [],
  PlaneWorkItemListSlice
> = (set, get) => ({
  planeSearchCache: {},
  planeListCache: {},
  planeListInvalidationToken,

  getCachedPlaneWorkItems: (args) => {
    const workspaceId = getSelectedPlaneWorkspaceId(get().planeStatus)
    if (args.kind === 'search') {
      const cacheKey = planeSearchCacheKey(workspaceId, args.projectId, args.query)
      return get().planeSearchCache[cacheKey]?.data ?? null
    }
    const cacheKey = planeWorkItemListCacheKey(
      workspaceId,
      args.filter ?? 'assigned',
      args.projectId
    )
    return get().planeListCache[cacheKey]?.data ?? null
  },

  searchPlaneWorkItems: async (query, projectId, workspaceId, options) => {
    const contextKey = getProviderRuntimeContextKey(get().settings)
    const resolvedWorkspaceId = workspaceId ?? getSelectedPlaneWorkspaceId(get().planeStatus)
    const cacheKey = planeSearchCacheKey(resolvedWorkspaceId, projectId, query)
    const cached = get().planeSearchCache[cacheKey]
    if (!options?.force && isFreshPlaneCacheEntry(cached)) {
      return cached.data ?? []
    }
    const inflight = inflightSearchRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === currentPlaneMutationGeneration() &&
      (!options?.force || inflight.force)
    ) {
      return inflight.promise
    }
    const requestCacheGeneration = currentPlaneCacheGeneration()
    const requestMutationGeneration = currentPlaneMutationGeneration()
    let entry: InflightPlaneListRead
    const promise = planeSearchWorkItems(get().settings, query, projectId, resolvedWorkspaceId)
      .then((items) => {
        if (
          inflightSearchRequests.get(cacheKey) === entry &&
          canWritePlaneReadResult(
            contextKey,
            getProviderRuntimeContextKey(get().settings),
            requestCacheGeneration,
            requestMutationGeneration
          )
        ) {
          set((s) => ({
            planeSearchCache: evictStalePlaneCacheEntries({
              ...s.planeSearchCache,
              [cacheKey]: { data: items, fetchedAt: Date.now() }
            })
          }))
        }
        return items
      })
      .catch((error) => {
        console.warn('[plane] searchPlaneWorkItems failed:', error)
        if (isIntegrationCredentialDecryptionError(error) || looksLikePlaneAuthError(error)) {
          void get().checkPlaneConnection(true)
        }
        return get().planeSearchCache[cacheKey]?.data ?? []
      })
      .finally(() => {
        if (inflightSearchRequests.get(cacheKey) === entry) {
          inflightSearchRequests.delete(cacheKey)
        }
      })
    entry = {
      promise,
      contextKey,
      mutationGeneration: requestMutationGeneration,
      force: options?.force
    }
    inflightSearchRequests.set(cacheKey, entry)
    return promise
  },

  listPlaneWorkItems: async (filter = 'assigned', projectId, workspaceId, options) => {
    const contextKey = getProviderRuntimeContextKey(get().settings)
    const resolvedWorkspaceId = workspaceId ?? getSelectedPlaneWorkspaceId(get().planeStatus)
    const cacheKey = planeWorkItemListCacheKey(resolvedWorkspaceId, filter, projectId)
    const cached = get().planeListCache[cacheKey]
    if (!options?.force && isFreshPlaneCacheEntry(cached)) {
      return cached.data ?? []
    }
    const inflight = inflightListRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === currentPlaneMutationGeneration() &&
      (!options?.force || inflight.force)
    ) {
      return inflight.promise
    }
    const requestCacheGeneration = currentPlaneCacheGeneration()
    const requestMutationGeneration = currentPlaneMutationGeneration()
    let entry: InflightPlaneListRead
    const promise = planeListWorkItems(get().settings, {
      filter,
      projectId,
      workspaceId: resolvedWorkspaceId
    })
      .then((items) => {
        if (
          inflightListRequests.get(cacheKey) === entry &&
          canWritePlaneReadResult(
            contextKey,
            getProviderRuntimeContextKey(get().settings),
            requestCacheGeneration,
            requestMutationGeneration
          )
        ) {
          set((s) => ({
            planeListCache: evictStalePlaneCacheEntries({
              ...s.planeListCache,
              [cacheKey]: { data: items, fetchedAt: Date.now() }
            })
          }))
        }
        return items
      })
      .catch((error) => {
        console.warn('[plane] listPlaneWorkItems failed:', error)
        if (isIntegrationCredentialDecryptionError(error) || looksLikePlaneAuthError(error)) {
          void get().checkPlaneConnection(true)
        }
        return get().planeListCache[cacheKey]?.data ?? []
      })
      .finally(() => {
        if (inflightListRequests.get(cacheKey) === entry) {
          inflightListRequests.delete(cacheKey)
        }
      })
    entry = {
      promise,
      contextKey,
      mutationGeneration: requestMutationGeneration,
      force: options?.force
    }
    inflightListRequests.set(cacheKey, entry)
    return promise
  },

  // Why: bumping the cache generation here (not just clearing state) rejects
  // any read captured before this call once it resolves, so a slow stale
  // fetch can't repopulate the cache we just invalidated.
  invalidatePlaneWorkItemLists: () => {
    bumpPlaneCacheGeneration()
    inflightListRequests.clear()
    inflightSearchRequests.clear()
    planeListInvalidationToken = {
      scope: getProviderRuntimeContextKey(get().settings),
      version: (planeListInvalidationToken.version + 1) % PLANE_LIST_INVALIDATION_VERSION_CAP
    }
    set({ planeListCache: {}, planeSearchCache: {}, planeListInvalidationToken })
  }
})
