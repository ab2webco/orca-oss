import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  PlaneConnectArgs,
  PlaneConnectionStatus,
  PlaneWorkspaceSelection
} from '../../../../shared/plane-types'
import {
  planeConnect,
  planeDisconnect,
  planeSelectWorkspace,
  planeStatus,
  planeTestConnection,
  type PlaneConnectResult
} from '@/runtime/runtime-plane-client'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  beginPlaneMutation,
  bumpPlaneCacheGeneration,
  currentPlaneMutationGeneration,
  getSelectedPlaneWorkspaceId
} from './plane-cache-guards'

export const planeEmptyStatus: PlaneConnectionStatus = { connected: false, viewer: null }

function planeStatusScopeSignature(status: PlaneConnectionStatus): string {
  return JSON.stringify({
    connected: status.connected,
    credentialError: status.credentialError ?? null,
    activeWorkspaceId: status.activeWorkspaceId ?? null,
    selectedWorkspaceId: getSelectedPlaneWorkspaceId(status),
    viewer: status.viewer
  })
}

let inflightStatusRequest: { contextKey: string; promise: Promise<void> } | null = null

export type PlaneConnectionSlice = {
  planeStatus: PlaneConnectionStatus
  planeStatusChecked: boolean
  planeStatusContextKey: string | null

  checkPlaneConnection: (force?: boolean) => Promise<void>
  connectPlane: (args: PlaneConnectArgs) => Promise<PlaneConnectResult>
  testPlaneConnection: (workspaceId?: string | null) => Promise<PlaneConnectResult>
  selectPlaneWorkspace: (workspaceId: PlaneWorkspaceSelection) => Promise<void>
  disconnectPlane: (workspaceId?: string | null) => Promise<void>
}

// Why: every full-status change (connect/disconnect/select/scope drift) must
// invalidate ALL Plane caches so no stale in-flight read from before the
// switch can land — see canWritePlaneReadResult in plane-cache-guards.
function resetAllPlaneCaches(): Partial<AppState> {
  bumpPlaneCacheGeneration()
  return {
    planeWorkItemCache: {},
    planeSearchCache: {},
    planeListCache: {},
    planeProjectCache: {}
  }
}

export const createPlaneConnectionSlice: StateCreator<AppState, [], [], PlaneConnectionSlice> = (
  set,
  get
) => ({
  planeStatus: planeEmptyStatus,
  planeStatusChecked: false,
  planeStatusContextKey: null,

  checkPlaneConnection: async (force = false) => {
    const contextKey = getProviderRuntimeContextKey(get().settings)
    if (inflightStatusRequest && !force && inflightStatusRequest.contextKey === contextKey) {
      return inflightStatusRequest.promise
    }
    if (get().planeStatusContextKey !== contextKey) {
      set({ planeStatusChecked: false })
    }
    const request = planeStatus(get().settings)
      .then((status) => {
        if (getProviderRuntimeContextKey(get().settings) !== contextKey) {
          return
        }
        const prev = get().planeStatus
        if (planeStatusScopeSignature(prev) !== planeStatusScopeSignature(status)) {
          set({
            ...resetAllPlaneCaches(),
            planeStatus: status,
            planeStatusChecked: true,
            planeStatusContextKey: contextKey
          })
        } else {
          set({ planeStatusChecked: true, planeStatusContextKey: contextKey })
        }
      })
      .catch(() => {
        if (getProviderRuntimeContextKey(get().settings) !== contextKey) {
          return
        }
        set({
          ...resetAllPlaneCaches(),
          planeStatus: planeEmptyStatus,
          planeStatusChecked: true,
          planeStatusContextKey: contextKey
        })
      })
      .finally(() => {
        if (inflightStatusRequest?.promise === request) {
          inflightStatusRequest = null
        }
      })
    inflightStatusRequest = { contextKey, promise: request }
    return request
  },

  connectPlane: async (args) => {
    const requestGeneration = beginPlaneMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    try {
      const result = await planeConnect(get().settings, args)
      if (
        result.ok &&
        requestGeneration === currentPlaneMutationGeneration() &&
        getProviderRuntimeContextKey(get().settings) === contextKey
      ) {
        set(resetAllPlaneCaches())
        const status = await planeStatus(get().settings)
        set({ planeStatus: status, planeStatusChecked: true, planeStatusContextKey: contextKey })
      }
      return result
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : 'Connection failed'
      }
    }
  },

  testPlaneConnection: async (workspaceId) => {
    try {
      return await planeTestConnection(get().settings, workspaceId)
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : 'Test failed' }
    }
  },

  selectPlaneWorkspace: async (workspaceId) => {
    const requestGeneration = beginPlaneMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    const status = await planeSelectWorkspace(get().settings, workspaceId)
    if (
      requestGeneration !== currentPlaneMutationGeneration() ||
      getProviderRuntimeContextKey(get().settings) !== contextKey
    ) {
      return
    }
    set({
      ...resetAllPlaneCaches(),
      planeStatus: status,
      planeStatusChecked: true,
      planeStatusContextKey: contextKey
    })
  },

  disconnectPlane: async (workspaceId) => {
    const requestGeneration = beginPlaneMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    await planeDisconnect(get().settings, workspaceId)
    if (
      requestGeneration !== currentPlaneMutationGeneration() ||
      getProviderRuntimeContextKey(get().settings) !== contextKey
    ) {
      return
    }
    set({
      ...resetAllPlaneCaches(),
      planeStatus: planeEmptyStatus,
      planeStatusChecked: true,
      planeStatusContextKey: contextKey
    })
  }
})
