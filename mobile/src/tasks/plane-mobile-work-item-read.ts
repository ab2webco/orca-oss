import { z } from 'zod'
import type { PlaneWorkItemPriority } from '../../../src/shared/plane-types'

// Why: Plane states, priorities and groups are server-owned data. A host that
// learns a new value must not blank the phone's list, so every soft field
// degrades to a rendered default instead of dropping the row (ORCA-155).
const PLANE_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const

const PlaneMobileStateSchema = z
  .object({
    id: z.string().default(''),
    name: z.string().default(''),
    group: z.string().default(''),
    color: z.string().optional(),
    sequence: z.number().optional()
  })
  .passthrough()
  .catch({ id: '', name: '', group: '' })

const PlaneMobileProjectSchema = z
  .object({
    id: z.string().default(''),
    identifier: z.string().default(''),
    name: z.string().default(''),
    archived: z.boolean().optional()
  })
  .passthrough()

const PlaneMobileWorkItemSchema = z
  .object({
    id: z.string().min(1),
    identifier: z.string().default(''),
    title: z.string().default(''),
    url: z.string().default(''),
    workspaceId: z.string().optional(),
    project: PlaneMobileProjectSchema.catch({ id: '', identifier: '', name: '' }),
    state: PlaneMobileStateSchema,
    priority: z.enum(PLANE_PRIORITIES).catch('none'),
    updatedAt: z.string().default('')
  })
  .passthrough()

export type PlaneMobileWorkItem = z.infer<typeof PlaneMobileWorkItemSchema>
export type PlaneMobileProject = z.infer<typeof PlaneMobileProjectSchema>
export type PlaneMobileState = z.infer<typeof PlaneMobileStateSchema>

const PlaneStatusSchema = z
  .object({
    connected: z.boolean().default(false),
    activeWorkspaceId: z.string().nullish(),
    selectedWorkspaceId: z.string().nullish(),
    credentialError: z.string().nullish(),
    workspaces: z
      .array(
        z
          .object({
            id: z.string().min(1),
            workspaceSlug: z.string().default(''),
            displayName: z.string().optional()
          })
          .passthrough()
      )
      .default([])
  })
  .passthrough()

export type PlaneMobileStatus = z.infer<typeof PlaneStatusSchema>

export function decodePlaneStatus(result: unknown): PlaneMobileStatus {
  const parsed = PlaneStatusSchema.safeParse(result)
  if (!parsed.success) {
    throw new Error('Unexpected Plane status response')
  }
  return parsed.data
}

function decodeRows<T>(result: unknown, schema: z.ZodType<T>, label: string): T[] {
  const source = Array.isArray(result) ? result : (result as { items?: unknown } | null)?.items
  if (!Array.isArray(source)) {
    throw new Error(`Unexpected Plane ${label} response`)
  }
  const rows: T[] = []
  for (const entry of source) {
    const parsed = schema.safeParse(entry)
    if (parsed.success) {
      rows.push(parsed.data)
    }
  }
  return rows
}

export function decodePlaneWorkItems(result: unknown): PlaneMobileWorkItem[] {
  return decodeRows(result, PlaneMobileWorkItemSchema, 'work items')
}

export function decodePlaneProjects(result: unknown): PlaneMobileProject[] {
  return decodeRows(result, PlaneMobileProjectSchema, 'projects')
}

export function decodePlaneStates(result: unknown): PlaneMobileState[] {
  return decodeRows(result, PlaneMobileStateSchema, 'states')
}

const PRIORITY_RANK: Record<PlaneWorkItemPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4
}

export function getPlanePriorityRank(priority: PlaneWorkItemPriority): number {
  return PRIORITY_RANK[priority]
}
