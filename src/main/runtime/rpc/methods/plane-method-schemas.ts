import { z } from 'zod'
import { OptionalPlainString, OptionalString, requiredString } from '../schemas'

// Zod params for the Plane RPC methods. Split out of plane.ts so the method
// table stays under the per-file line cap. Write-back covers create +
// state/assign/comment/link updates; work-item delete remains deferred (see
// the approved plane-task-provider scope decision).
const VALID_FILTERS = ['everything', 'assigned', 'created', 'all', 'done'] as const
const VALID_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
const VALID_STATE_GROUPS = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as const

export const WorkspaceSelection = z
  .object({
    workspaceId: OptionalString
  })
  .optional()

// Archived projects come back from Plane's project list, so callers say
// whether they want them. Absent = include, which keeps the app's pickers on
// their pre-ORCA-140 behavior; the CLI passes false explicitly.
export const ListProjects = z
  .object({
    workspaceId: OptionalString,
    includeArchived: z.boolean().optional()
  })
  .optional()

export const Connect = z.object({
  baseUrl: requiredString('Base URL is required'),
  workspaceSlug: requiredString('Workspace slug is required'),
  apiKey: requiredString('API key is required')
})

export const SelectWorkspace = z.object({
  workspaceId: requiredString('Workspace is required')
})

export const ListWorkItems = z
  .object({
    projectId: OptionalString,
    filter: z.enum(VALID_FILTERS).optional(),
    workspaceId: OptionalString
  })
  .optional()

export const SearchWorkItems = z.object({
  query: requiredString('Missing search query'),
  projectId: OptionalString,
  workspaceId: OptionalString
})

export const GetWorkItem = z.object({
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

export const UpdateWorkItem = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  workspaceId: OptionalString,
  updates: WorkItemUpdate
})

export const CreateWorkItem = z.object({
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

export const AddWorkItemComment = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  body: requiredString('Comment body is required'),
  workspaceId: OptionalString
})

export const WorkItemComments = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  workspaceId: OptionalString
})

export const DeleteWorkItemComment = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  commentId: requiredString('Comment ID is required'),
  workspaceId: OptionalString
})

export const ProjectScoped = z.object({
  projectId: requiredString('Project is required'),
  workspaceId: OptionalString
})

export const CreateState = z.object({
  projectId: requiredString('Project is required'),
  workspaceId: OptionalString,
  name: requiredString('Column name is required'),
  group: z.enum(VALID_STATE_GROUPS),
  color: OptionalString
})

export const UpdateState = z.object({
  projectId: requiredString('Project is required'),
  stateId: requiredString('State ID is required'),
  workspaceId: OptionalString,
  name: OptionalString,
  color: OptionalString,
  sequence: z.number().optional()
})

export const DeleteState = z.object({
  projectId: requiredString('Project is required'),
  stateId: requiredString('State ID is required'),
  workspaceId: OptionalString
})

export const ListMembers = z
  .object({
    workspaceId: OptionalString,
    projectId: OptionalString
  })
  .optional()

// Hints for `--current`: resolve the work item linked to the caller's worktree.
// Mirrors Linear's LinearCurrentContext shape.
export const PlaneCurrentWorkItemContext = z
  .object({
    worktreeId: OptionalString,
    terminalHandle: OptionalString,
    cwd: OptionalString,
    remote: z.boolean().optional()
  })
  .optional()

// Attaches a Plane work item to the current worktree after the fact. The
// context resolves the worktree (like `--current`); identifier/projectId
// identify the Plane item to attach.
export const LinkCurrentWorkItem = z.object({
  context: PlaneCurrentWorkItemContext,
  identifier: requiredString('Work item ID is required'),
  projectId: requiredString('Project is required'),
  workspaceId: OptionalString
})

export const UnlinkCurrentWorkItem = z
  .object({
    context: PlaneCurrentWorkItemContext
  })
  .optional()
