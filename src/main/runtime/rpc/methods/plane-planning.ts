import { defineMethod, type RpcMethod } from '../core'
import {
  AddPlanningWorkItems,
  PlanningContainer,
  PlanningWorkItems
} from './plane-planning-schemas'

export const PLANE_PLANNING_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'plane.listPlanningContainers',
    params: PlanningContainer,
    handler: async (params, { runtime }) =>
      runtime.planeListPlanningContainers({
        kind: params.kind,
        projectId: params.projectId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.listPlanningWorkItems',
    params: PlanningWorkItems,
    handler: async (params, { runtime }) =>
      runtime.planeListPlanningWorkItems({
        kind: params.kind,
        projectId: params.projectId.trim(),
        containerId: params.containerId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.addPlanningWorkItems',
    params: AddPlanningWorkItems,
    handler: async (params, { runtime }) =>
      runtime.planeAddPlanningWorkItems({
        kind: params.kind,
        projectId: params.projectId.trim(),
        containerId: params.containerId.trim(),
        workItemIds: params.workItemIds.map((id) => id.trim()),
        workspaceId: params.workspaceId
      })
  })
]
