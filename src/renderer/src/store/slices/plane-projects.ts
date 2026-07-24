import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { PlaneProject } from '../../../../shared/plane-types'
import type { CacheEntry } from './github'
import { isIntegrationCredentialDecryptionError } from '../../../../shared/integration-credential-errors'
import { planeListProjects } from '@/runtime/runtime-plane-client'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  canWritePlaneReadResult,
  currentPlaneCacheGeneration,
  currentPlaneMutationGeneration,
  evictStalePlaneCacheEntries,
  getSelectedPlaneWorkspaceId,
  isFreshPlaneCacheEntry,
  looksLikePlaneAuthError,
  planeProjectCacheKey
} from './plane-cache-guards'
import type { PlaneFetchOptions } from './plane-work-item-lists'

type InflightPlaneProjectRead = {
  promise: Promise<PlaneProject[]>
  contextKey: string
  mutationGeneration: number
  force?: boolean
}

const inflightProjectRequests = new Map<string, InflightPlaneProjectRead>()

export type PlaneProjectSlice = {
  planeProjectCache: Record<string, CacheEntry<PlaneProject[]>>
  getCachedPlaneProjects: (workspaceId?: string | null) => PlaneProject[] | null
  listPlaneProjects: (
    workspaceId?: string | null,
    options?: PlaneFetchOptions
  ) => Promise<PlaneProject[]>
}

export const createPlaneProjectSlice: StateCreator<AppState, [], [], PlaneProjectSlice> = (
  set,
  get
) => ({
  planeProjectCache: {},

  getCachedPlaneProjects: (workspaceId) => {
    const resolvedWorkspaceId = workspaceId ?? getSelectedPlaneWorkspaceId(get().planeStatus)
    return get().planeProjectCache[planeProjectCacheKey(resolvedWorkspaceId)]?.data ?? null
  },

  listPlaneProjects: async (workspaceId, options) => {
    const contextKey = getProviderRuntimeContextKey(get().settings)
    const resolvedWorkspaceId = workspaceId ?? getSelectedPlaneWorkspaceId(get().planeStatus)
    const cacheKey = planeProjectCacheKey(resolvedWorkspaceId)
    const cached = get().planeProjectCache[cacheKey]
    if (!options?.force && isFreshPlaneCacheEntry(cached)) {
      return cached.data ?? []
    }
    const inflight = inflightProjectRequests.get(cacheKey)
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
    let entry: InflightPlaneProjectRead
    const promise = planeListProjects(get().settings, resolvedWorkspaceId)
      .then((projects) => {
        if (
          inflightProjectRequests.get(cacheKey) === entry &&
          canWritePlaneReadResult(
            contextKey,
            getProviderRuntimeContextKey(get().settings),
            requestCacheGeneration,
            requestMutationGeneration
          )
        ) {
          set((s) => ({
            planeProjectCache: evictStalePlaneCacheEntries({
              ...s.planeProjectCache,
              [cacheKey]: { data: projects, fetchedAt: Date.now() }
            })
          }))
        }
        return projects
      })
      .catch((error) => {
        console.warn('[plane] listPlaneProjects failed:', error)
        if (isIntegrationCredentialDecryptionError(error) || looksLikePlaneAuthError(error)) {
          void get().checkPlaneConnection(true)
        }
        return get().planeProjectCache[cacheKey]?.data ?? []
      })
      .finally(() => {
        if (inflightProjectRequests.get(cacheKey) === entry) {
          inflightProjectRequests.delete(cacheKey)
        }
      })
    entry = {
      promise,
      contextKey,
      mutationGeneration: requestMutationGeneration,
      force: options?.force
    }
    inflightProjectRequests.set(cacheKey, entry)
    return promise
  }
})
