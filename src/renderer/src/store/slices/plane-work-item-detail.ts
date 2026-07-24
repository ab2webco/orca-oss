import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { PlaneWorkItem } from '../../../../shared/plane-types'
import type { CacheEntry } from './github'
import { isIntegrationCredentialDecryptionError } from '../../../../shared/integration-credential-errors'
import { planeGetWorkItem } from '@/runtime/runtime-plane-client'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
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

  patchPlaneWorkItem: (workItemId, patch) => {
    set((s) => {
      let changed = false
      const next = { ...s.planeWorkItemCache }
      for (const [key, entry] of Object.entries(next)) {
        if (entry?.data?.id === workItemId) {
          next[key] = { ...entry, data: { ...entry.data, ...patch } }
          changed = true
        }
      }
      return changed ? { planeWorkItemCache: next } : {}
    })
  }
})
