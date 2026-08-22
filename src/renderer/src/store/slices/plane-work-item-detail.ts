import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { PlaneWorkItem } from '../../../../shared/plane-types'
import type { CacheEntry } from './github'
import { isIntegrationCredentialDecryptionError } from '../../../../shared/integration-credential-errors'
import { planeGetWorkItem } from '@/runtime/runtime-plane-client'
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
  planeWorkItemCacheKey
} from './plane-cache-guards'
import type { PlaneFetchOptions } from './plane-work-item-lists'

type InflightPlaneWorkItemRead = {
  promise: Promise<PlaneWorkItem | null>
  contextKey: string
  mutationGeneration: number
  force?: boolean
}

const inflightWorkItemRequests = new Map<string, InflightPlaneWorkItemRead>()

export type PlaneWorkItemDetailSlice = {
  planeWorkItemCache: Record<string, CacheEntry<PlaneWorkItem>>

  fetchPlaneWorkItem: (
    workItemId: string,
    projectId?: string,
    workspaceId?: string | null,
    options?: PlaneFetchOptions
  ) => Promise<PlaneWorkItem | null>
  refreshPlaneWorkItem: (
    workItemId: string,
    projectId?: string,
    workspaceId?: string | null
  ) => Promise<PlaneWorkItem | null>
  patchPlaneWorkItem: (workItemId: string, patch: Partial<PlaneWorkItem>) => void
}

export const createPlaneWorkItemDetailSlice: StateCreator<
  AppState,
  [],
  [],
  PlaneWorkItemDetailSlice
> = (set, get) => ({
  planeWorkItemCache: {},

  fetchPlaneWorkItem: async (workItemId, projectId, workspaceId, options) => {
    const contextKey = getProviderRuntimeContextKey(get().settings)
    const resolvedWorkspaceId = workspaceId ?? getSelectedPlaneWorkspaceId(get().planeStatus)
    const cacheKey = planeWorkItemCacheKey(resolvedWorkspaceId, workItemId)
    const cached = get().planeWorkItemCache[cacheKey]
    if (!options?.force && isFreshPlaneCacheEntry(cached)) {
      return cached.data
    }
    const inflight = inflightWorkItemRequests.get(cacheKey)
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
    let entry: InflightPlaneWorkItemRead
    const promise = planeGetWorkItem(get().settings, workItemId, projectId, resolvedWorkspaceId)
      .then((item) => {
        if (
          inflightWorkItemRequests.get(cacheKey) === entry &&
          canWritePlaneReadResult(
            contextKey,
            getProviderRuntimeContextKey(get().settings),
            requestCacheGeneration,
            requestMutationGeneration
          )
        ) {
          set((s) => ({
            planeWorkItemCache: evictStalePlaneCacheEntries({
              ...s.planeWorkItemCache,
              [cacheKey]: { data: item, fetchedAt: Date.now() }
            })
          }))
        }
        return item
      })
      .catch((error) => {
        console.warn('[plane] fetchPlaneWorkItem failed:', error)
        if (isIntegrationCredentialDecryptionError(error) || looksLikePlaneAuthError(error)) {
          void get().checkPlaneConnection(true)
        }
        return null
      })
      .finally(() => {
        if (inflightWorkItemRequests.get(cacheKey) === entry) {
          inflightWorkItemRequests.delete(cacheKey)
        }
      })
    entry = {
      promise,
      contextKey,
      mutationGeneration: requestMutationGeneration,
      force: options?.force
    }
    inflightWorkItemRequests.set(cacheKey, entry)
    return promise
  },

  refreshPlaneWorkItem: async (workItemId, projectId, workspaceId) => {
    const resolvedWorkspaceId = workspaceId ?? getSelectedPlaneWorkspaceId(get().planeStatus)
    const cacheKey = planeWorkItemCacheKey(resolvedWorkspaceId, workItemId)
    inflightWorkItemRequests.delete(cacheKey)
    set((s) => {
      const nextCache = { ...s.planeWorkItemCache }
      delete nextCache[cacheKey]
      return { planeWorkItemCache: nextCache, planeSearchCache: {}, planeListCache: {} }
    })
    return get().fetchPlaneWorkItem(workItemId, projectId, workspaceId, { force: true })
  },

  // Why bump the cache generation here: this is the ONLY point every optimistic
  // Plane write passes through (board drag included), and a list/search fetch
  // already in flight when the user edits must not be allowed to land the
  // pre-edit snapshot back over it — see canWritePlaneReadResult. Patching the
  // list/search caches in place (not just the single-item cache) means that
  // rejected, now-stale fetch has a CORRECT value to fall back to instead of an
  // empty result (see listPlaneWorkItems / searchPlaneWorkItems).
  patchPlaneWorkItem: (workItemId, patch) => {
    bumpPlaneCacheGeneration()
    set((s) => {
      let changed = false
      const nextItemCache = { ...s.planeWorkItemCache }
      for (const [key, entry] of Object.entries(nextItemCache)) {
        if (entry?.data?.id === workItemId) {
          nextItemCache[key] = { ...entry, data: { ...entry.data, ...patch } }
          changed = true
        }
      }
      const patchListLikeCache = (
        cache: Record<string, CacheEntry<PlaneWorkItem[]>>
      ): { cache: Record<string, CacheEntry<PlaneWorkItem[]>>; changed: boolean } => {
        let localChanged = false
        const next = { ...cache }
        for (const [key, entry] of Object.entries(cache)) {
          const index = entry?.data?.findIndex((item) => item.id === workItemId) ?? -1
          if (!entry?.data || index === -1) {
            continue
          }
          const nextData = [...entry.data]
          nextData[index] = { ...nextData[index], ...patch }
          next[key] = { data: nextData, fetchedAt: Date.now() }
          localChanged = true
        }
        return { cache: localChanged ? next : cache, changed: localChanged }
      }
      const listResult = patchListLikeCache(s.planeListCache)
      const searchResult = patchListLikeCache(s.planeSearchCache)
      changed = changed || listResult.changed || searchResult.changed
      return changed
        ? {
            planeWorkItemCache: nextItemCache,
            planeListCache: listResult.cache,
            planeSearchCache: searchResult.cache
          }
        : {}
    })
  }
})
