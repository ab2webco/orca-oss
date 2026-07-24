import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalPlainString, OptionalString, requiredString } from '../schemas'

// Write-back covers create + state/assign/comment updates; work-item delete
// remains deferred (see the approved plane-task-provider scope decision).
const VALID_FILTERS = ['everything', 'assigned', 'created', 'all', 'done'] as const
const VALID_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
const VALID_STATE_GROUPS = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as const

const WorkspaceSelection = z
  .object({
    workspaceId: OptionalString
  })
  .optional()

const Connect = z.object({
  baseUrl: requiredString('Base URL is required'),
  workspaceSlug: requiredString('Workspace slug is required'),
  apiKey: requiredString('API key is required')
})

const SelectWorkspace = z.object({
  workspaceId: requiredString('Workspace is required')
})

const ListWorkItems = z
  .object({
    projectId: OptionalString,
    filter: z.enum(VALID_FILTERS).optional(),
    workspaceId: OptionalString
  })
  .optional()

const SearchWorkItems = z.object({
  query: requiredString('Missing search query'),
  projectId: OptionalString,
  workspaceId: OptionalString
})

const GetWorkItem = z.object({
  workItemId: requiredString('Work item ID is required'),
  projectId: OptionalString,
  workspaceId: OptionalString
})

const WorkItemUpdate = z.object({
  title: OptionalString,
  description: OptionalPlainString,
  labelIds: z.array(z.string()).optional(),
  assigneeIds: z.array(z.string()).optional(),
  priority: z.enum(VALID_PRIORITIES).optional(),
  stateId: OptionalString,
  startDate: OptionalString,
  targetDate: OptionalString,
  parentId: z.union([z.string(), z.null()]).optional()
})

const UpdateWorkItem = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  workspaceId: OptionalString,
  updates: WorkItemUpdate
})

const CreateWorkItem = z.object({
  projectId: requiredString('Project is required'),
  title: requiredString('Title is required'),
  workspaceId: OptionalString,
  description: OptionalPlainString,
  stateId: OptionalString,
  assigneeIds: z.array(z.string()).optional(),
  labelIds: z.array(z.string()).optional(),
  priority: z.enum(VALID_PRIORITIES).optional(),
  startDate: OptionalString,
  targetDate: OptionalString,
  parentId: z.union([z.string(), z.null()]).optional()
})

const AddWorkItemComment = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  body: requiredString('Comment body is required'),
  workspaceId: OptionalString
})

const WorkItemComments = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  workspaceId: OptionalString
})

const ProjectScoped = z.object({
  projectId: requiredString('Project is required'),
  workspaceId: OptionalString
})

const CreateState = z.object({
  projectId: requiredString('Project is required'),
  workspaceId: OptionalString,
  name: requiredString('Column name is required'),
  group: z.enum(VALID_STATE_GROUPS),
  color: OptionalString
})

const UpdateState = z.object({
  projectId: requiredString('Project is required'),
  stateId: requiredString('State ID is required'),
  workspaceId: OptionalString,
  name: OptionalString,
  color: OptionalString,
  sequence: z.number().optional()
})

const DeleteState = z.object({
  projectId: requiredString('Project is required'),
  stateId: requiredString('State ID is required'),
  workspaceId: OptionalString
})

const ListMembers = z
  .object({
    workspaceId: OptionalString,
    projectId: OptionalString
  })
  .optional()

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
