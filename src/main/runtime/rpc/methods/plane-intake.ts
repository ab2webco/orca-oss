import { defineMethod, type RpcMethod } from '../core'
import { CreateIntakeIssue, ListIntakeIssues, SetIntakeEnabled } from './plane-method-schemas'

export const PLANE_INTAKE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'plane.listIntakeIssues',
    params: ListIntakeIssues,
    handler: async (params, { runtime }) =>
      runtime.planeListIntakeIssues({
        projectId: params.projectId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.createIntakeIssue',
    params: CreateIntakeIssue,
    handler: async (params, { runtime }) =>
      runtime.planeCreateIntakeIssue({
        projectId: params.projectId.trim(),
        title: params.title.trim(),
        workspaceId: params.workspaceId,
        description: params.description,
        priority: params.priority
      })
  }),
  defineMethod({
    name: 'plane.setIntakeEnabled',
    params: SetIntakeEnabled,
    handler: async (params, { runtime }) =>
      runtime.planeSetIntakeEnabled({
        projectId: params.projectId.trim(),
        enabled: params.enabled,
        workspaceId: params.workspaceId
      })
  })
]
