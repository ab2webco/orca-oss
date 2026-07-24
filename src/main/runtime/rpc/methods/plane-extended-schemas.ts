import { z } from 'zod'
import { OptionalString, requiredString } from '../schemas'

// Zod params for the extended Plane RPC methods (delete, relations, links,
// label create). Split from plane-method-schemas.ts so both stay under the
// per-file line cap. Relation/link endpoint shapes are assumed against Plane
// REST v1 — see the main-side notes.
const VALID_RELATION_TYPES = [
  'relates_to',
  'blocking',
  'blocked_by',
  'duplicate',
  'start_after',
  'start_before',
  'finish_after',
  'finish_before'
] as const

// project + work item UUID; shared by delete and the relation/link list reads.
export const ProjectWorkItem = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  workspaceId: OptionalString
})

export const AddRelation = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  relationType: z.enum(VALID_RELATION_TYPES),
  relatedWorkItemId: requiredString('Related work item ID is required'),
  workspaceId: OptionalString
})

export const AddLink = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  url: requiredString('Link URL is required'),
  title: OptionalString,
  workspaceId: OptionalString
})

export const DeleteLink = z.object({
  projectId: requiredString('Project is required'),
  workItemId: requiredString('Work item ID is required'),
  linkId: requiredString('Link ID is required'),
  workspaceId: OptionalString
})

export const CreateLabel = z.object({
  projectId: requiredString('Project is required'),
  name: requiredString('Label name is required'),
  color: OptionalString,
  workspaceId: OptionalString
})
