// Why: uncached write/metadata calls (mutations, comments, pickers) split out
// of plane-work-items.ts so neither file needs a max-lines exception.
import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  PlaneComment,
  PlaneLabel,
  PlaneMutationResult,
  PlaneState as PlaneWorkflowState,
  PlaneUser,
  PlaneWorkItem,
  PlaneWorkItemUpdate
} from '../../../../shared/plane-types'
import {
  planeAddWorkItemComment,
  planeListLabels,
  planeListMembers,
  planeListStates,
  planeListWorkItemComments,
  planeUpdateWorkItem,
  type PlaneCommentResult
} from '@/runtime/runtime-plane-client'

export type PlaneWorkItemActionSlice = {
  updatePlaneWorkItem: (
    projectId: string,
    workItemId: string,
    updates: PlaneWorkItemUpdate,
    workspaceId?: string | null
  ) => Promise<PlaneMutationResult>
  addPlaneWorkItemComment: (
    projectId: string,
    workItemId: string,
    body: string,
    workspaceId?: string | null
  ) => Promise<PlaneCommentResult>
  listPlaneWorkItemComments: (
    projectId: string,
    workItemId: string,
    workspaceId?: string | null
  ) => Promise<PlaneComment[]>
  listPlaneStates: (projectId: string, workspaceId?: string | null) => Promise<PlaneWorkflowState[]>
  listPlaneLabels: (projectId: string, workspaceId?: string | null) => Promise<PlaneLabel[]>
  listPlaneMembers: (workspaceId?: string | null) => Promise<PlaneUser[]>
}

export const createPlaneWorkItemActionSlice: StateCreator<
  AppState,
  [],
  [],
  PlaneWorkItemActionSlice
> = (_set, get) => ({
  updatePlaneWorkItem: async (projectId, workItemId, updates, workspaceId) => {
    const result = await planeUpdateWorkItem(
      get().settings,
      projectId,
      workItemId,
      updates,
      workspaceId
    )
    if (result.ok) {
      get().patchPlaneWorkItem(workItemId, updates as Partial<PlaneWorkItem>)
      get().invalidatePlaneWorkItemLists()
    }
    return result
  },

  addPlaneWorkItemComment: async (projectId, workItemId, body, workspaceId) =>
    planeAddWorkItemComment(get().settings, projectId, workItemId, body, workspaceId),

  listPlaneWorkItemComments: async (projectId, workItemId, workspaceId) =>
    planeListWorkItemComments(get().settings, projectId, workItemId, workspaceId),

  listPlaneStates: async (projectId, workspaceId) =>
    planeListStates(get().settings, projectId, workspaceId),

  listPlaneLabels: async (projectId, workspaceId) =>
    planeListLabels(get().settings, projectId, workspaceId),

  listPlaneMembers: async (workspaceId) => planeListMembers(get().settings, workspaceId)
})
