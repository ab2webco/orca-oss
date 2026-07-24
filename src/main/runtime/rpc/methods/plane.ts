import { defineMethod, type RpcMethod } from '../core'
import {
  AddWorkItemComment,
  Connect,
  CreateState,
  CreateWorkItem,
  DeleteState,
  GetWorkItem,
  LinkCurrentWorkItem,
  ListMembers,
  ListWorkItems,
  PlaneCurrentWorkItemContext,
  ProjectScoped,
  SearchWorkItems,
  SelectWorkspace,
  UnlinkCurrentWorkItem,
  UpdateState,
  UpdateWorkItem,
  WorkItemComments,
  WorkspaceSelection
} from './plane-method-schemas'

export const PLANE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'plane.connect',
    params: Connect,
    handler: async (params, { runtime }) =>
      runtime.planeConnect({
        baseUrl: params.baseUrl.trim(),
        workspaceSlug: params.workspaceSlug.trim(),
        apiKey: params.apiKey.trim()
      })
  }),
  defineMethod({
    name: 'plane.disconnect',
    params: WorkspaceSelection,
    handler: async (params, { runtime }) => runtime.planeDisconnect(params?.workspaceId)
  }),
  defineMethod({
    name: 'plane.selectWorkspace',
    params: SelectWorkspace,
    handler: async (params, { runtime }) => runtime.planeSelectWorkspace(params.workspaceId.trim())
  }),
  defineMethod({
    name: 'plane.status',
    params: null,
    handler: async (_params, { runtime }) => runtime.planeStatus()
  }),
  defineMethod({
    name: 'plane.getMe',
    params: WorkspaceSelection,
    handler: async (params, { runtime }) => runtime.planeGetMe(params?.workspaceId)
  }),
  defineMethod({
    name: 'plane.testConnection',
    params: WorkspaceSelection,
    handler: async (params, { runtime }) => runtime.planeTestConnection(params?.workspaceId)
  }),
  defineMethod({
    name: 'plane.listWorkItems',
    params: ListWorkItems,
    handler: async (params, { runtime }) =>
      runtime.planeListWorkItems({
        projectId: params?.projectId,
        filter: params?.filter ?? 'all',
        workspaceId: params?.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.searchWorkItems',
    params: SearchWorkItems,
    handler: async (params, { runtime }) =>
      runtime.planeSearchWorkItems({
        query: params.query.trim(),
        projectId: params.projectId,
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.getWorkItem',
    params: GetWorkItem,
    handler: async (params, { runtime }) =>
      runtime.planeGetWorkItem({
        workItemId: params.workItemId.trim(),
        projectId: params.projectId,
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.resolveCurrentWorkItem',
    params: PlaneCurrentWorkItemContext,
    handler: async (params, { runtime }) => runtime.planeResolveCurrentWorkItem(params)
  }),
  defineMethod({
    name: 'plane.linkCurrentWorkItem',
    params: LinkCurrentWorkItem,
    handler: async (params, { runtime }) =>
      runtime.planeLinkCurrentWorkItem({
        context: params.context,
        identifier: params.identifier.trim(),
        projectId: params.projectId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.unlinkCurrentWorkItem',
    params: UnlinkCurrentWorkItem,
    handler: async (params, { runtime }) =>
      runtime.planeUnlinkCurrentWorkItem({ context: params?.context })
  }),
  defineMethod({
    name: 'plane.updateWorkItem',
    params: UpdateWorkItem,
    handler: async (params, { runtime }) =>
      runtime.planeUpdateWorkItem({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        workspaceId: params.workspaceId,
        updates: params.updates
      })
  }),
  defineMethod({
    name: 'plane.createWorkItem',
    params: CreateWorkItem,
    handler: async (params, { runtime }) =>
      runtime.planeCreateWorkItem({
        projectId: params.projectId.trim(),
        title: params.title.trim(),
        workspaceId: params.workspaceId,
        description: params.description,
        stateId: params.stateId,
        assigneeIds: params.assigneeIds,
        labelIds: params.labelIds,
        priority: params.priority,
        startDate: params.startDate,
        targetDate: params.targetDate,
        parentId: params.parentId
      })
  }),
  defineMethod({
    name: 'plane.addWorkItemComment',
    params: AddWorkItemComment,
    handler: async (params, { runtime }) =>
      runtime.planeAddWorkItemComment({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        body: params.body.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.listWorkItemComments',
    params: WorkItemComments,
    handler: async (params, { runtime }) =>
      runtime.planeListWorkItemComments({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.createState',
    params: CreateState,
    handler: async (params, { runtime }) =>
      runtime.planeCreateState({
        projectId: params.projectId.trim(),
        workspaceId: params.workspaceId,
        name: params.name.trim(),
        group: params.group,
        color: params.color
      })
  }),
  defineMethod({
    name: 'plane.updateState',
    params: UpdateState,
    handler: async (params, { runtime }) =>
      runtime.planeUpdateState({
        projectId: params.projectId.trim(),
        stateId: params.stateId.trim(),
        workspaceId: params.workspaceId,
        name: params.name,
        color: params.color,
        sequence: params.sequence
      })
  }),
  defineMethod({
    name: 'plane.deleteState',
    params: DeleteState,
    handler: async (params, { runtime }) =>
      runtime.planeDeleteState({
        projectId: params.projectId.trim(),
        stateId: params.stateId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.listProjects',
    params: WorkspaceSelection,
    handler: async (params, { runtime }) => runtime.planeListProjects(params?.workspaceId)
  }),
  defineMethod({
    name: 'plane.listStates',
    params: ProjectScoped,
    handler: async (params, { runtime }) =>
      runtime.planeListStates(params.projectId.trim(), params.workspaceId)
  }),
  defineMethod({
    name: 'plane.listLabels',
    params: ProjectScoped,
    handler: async (params, { runtime }) =>
      runtime.planeListLabels(params.projectId.trim(), params.workspaceId)
  }),
  defineMethod({
    name: 'plane.listMembers',
    params: ListMembers,
    handler: async (params, { runtime }) =>
      runtime.planeListMembers(params?.workspaceId, params?.projectId)
  })
]
