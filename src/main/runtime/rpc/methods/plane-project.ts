import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalPlainString, OptionalString, requiredString } from '../schemas'

// Project-level Plane RPC methods (create/update/archive). Kept in their own
// file — with their zod params inline, since nothing else composes them —
// because these are the only Plane writes scoped to the workspace instead of a
// project. `workspace` accepts a saved workspace id OR a workspace slug.
const CreateProject = z.object({
  name: requiredString('Project name is required'),
  identifier: requiredString('Project identifier is required'),
  description: OptionalPlainString,
  workspace: OptionalString
})

const UpdateProject = z.object({
  projectId: requiredString('Project is required'),
  name: OptionalString,
  identifier: OptionalString,
  description: OptionalPlainString,
  workspace: OptionalString
})

const ArchiveProject = z.object({
  projectId: requiredString('Project is required'),
  archived: z.boolean(),
  workspace: OptionalString
})

export const PLANE_PROJECT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'plane.createProject',
    params: CreateProject,
    handler: async (params, { runtime }) =>
      runtime.planeCreateProject({
        name: params.name.trim(),
        identifier: params.identifier.trim(),
        description: params.description,
        workspace: params.workspace
      })
  }),
  defineMethod({
    name: 'plane.updateProject',
    params: UpdateProject,
    handler: async (params, { runtime }) =>
      runtime.planeUpdateProject({
        projectId: params.projectId.trim(),
        name: params.name?.trim(),
        identifier: params.identifier?.trim(),
        description: params.description,
        workspace: params.workspace
      })
  }),
  defineMethod({
    name: 'plane.setProjectArchived',
    params: ArchiveProject,
    handler: async (params, { runtime }) =>
      runtime.planeSetProjectArchived({
        projectId: params.projectId.trim(),
        archived: params.archived,
        workspace: params.workspace
      })
  })
]
