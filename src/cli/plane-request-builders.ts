import type {
  PlaneCreateWorkItemResult,
  PlaneCurrentWorkItem,
  PlaneCurrentWorkItemContextHints,
  PlaneLabel,
  PlaneLabelMutationResult,
  PlaneLinkMutationResult,
  PlaneMutationResult,
  PlaneState,
  PlaneStateGroup,
  PlaneStateMutationResult,
  PlaneWorkItem,
  PlaneWorkItemFilter,
  PlaneWorkItemLink,
  PlaneWorkItemPriority
} from '../shared/plane-types'

export type PlaneCreatedWorkItem = Extract<PlaneCreateWorkItemResult, { ok: true }>
import {
  getOptionalStringFlag,
  getRequiredStringFlag,
  getRequiredStringFlagAllowingEmpty
} from './flags'
import { RuntimeClientError } from './runtime-client'
import type { RuntimeClient, RuntimeRpcSuccess } from './runtime-client'

export type PlaneWriteTarget = {
  workItemId: string
  projectId: string
  workspaceId: string | undefined
}

// Builds the resolution hints for `--current`. Mirrors buildLinearCurrentContext:
// on a remote runtime the cwd is meaningless, so the host resolves the worktree
// from the ORCA_WORKTREE_ID / ORCA_TERMINAL_HANDLE env instead.
export function buildPlaneCurrentContext(
  cwd: string,
  remote: boolean
): PlaneCurrentWorkItemContextHints {
  return {
    remote,
    ...(remote ? {} : { cwd }),
    ...(process.env.ORCA_WORKTREE_ID ? { worktreeId: process.env.ORCA_WORKTREE_ID } : {}),
    ...(process.env.ORCA_TERMINAL_HANDLE
      ? { terminalHandle: process.env.ORCA_TERMINAL_HANDLE }
      : {})
  }
}

// Resolves the Plane work item linked to the current worktree, or throws a
// stable plane_work_item_required error when there is no link to fall back on.
export async function resolvePlaneCurrentWorkItem(
  client: RuntimeClient,
  cwd: string
): Promise<RuntimeRpcSuccess<PlaneCurrentWorkItem>> {
  const response = await client.call<PlaneCurrentWorkItem | null>(
    'plane.resolveCurrentWorkItem',
    buildPlaneCurrentContext(cwd, client.isRemote)
  )
  if (!response.result) {
    throw new RuntimeClientError(
      'plane_work_item_required',
      'Run --current inside a Plane-linked Orca worktree, or pass a work item id.'
    )
  }
  return { ...response, result: response.result }
}

// Resolves the {id, project, workspace} a Plane write targets, from either an
// explicit id (project required) or the `--current` worktree link (project/
// workspace inherited from the link unless overridden by flags). The Plane REST
// write routes require the work item UUID, so both paths resolve to `.id`
// rather than the human identifier (which 404s on the write endpoints).
export async function resolvePlaneWriteTarget(args: {
  flags: Map<string, string | boolean>
  client: RuntimeClient
  cwd: string
}): Promise<PlaneWriteTarget> {
  const { flags, client, cwd } = args
  rejectAllWorkspaceForPlaneWrite(flags)
  const explicitId = getOptionalStringFlag(flags, 'id')
  const current = flags.get('current') === true
  if (explicitId && current) {
    throw new RuntimeClientError('invalid_argument', 'Pass either <id> or --current, not both')
  }
  const workspaceId = getOptionalStringFlag(flags, 'workspace')
  if (current) {
    const resolved = (await resolvePlaneCurrentWorkItem(client, cwd)).result
    if (!resolved.workItem) {
      throw new RuntimeClientError(
        'plane_work_item_not_found',
        `Plane work item ${resolved.identifier} is linked to this worktree but could not be fetched`
      )
    }
    return {
      workItemId: resolved.workItem.id,
      projectId: getOptionalStringFlag(flags, 'project') ?? resolved.projectId,
      workspaceId: workspaceId ?? resolved.workspaceId
    }
  }
  const requestedId = getRequiredStringFlag(flags, 'id')
  const projectId = getRequiredStringFlag(flags, 'project')
  const workItemId = await resolvePlaneWorkItemUuid(client, requestedId, projectId, workspaceId)
  return { workItemId, projectId, workspaceId }
}

// Resolves the --parent flag to the UUID Plane's write routes require. The
// literal `null` clears the parent (returns null); any other value resolves
// through getWorkItem exactly like the target id; an absent flag returns
// undefined so the caller leaves `parent` untouched.
export async function resolvePlaneParentFlag(
  flags: Map<string, string | boolean>,
  client: RuntimeClient,
  projectId: string,
  workspaceId: string | undefined
): Promise<string | null | undefined> {
  if (!flags.has('parent')) {
    return undefined
  }
  const value = getRequiredStringFlagAllowingEmpty(flags, 'parent')
  if (value === 'null') {
    return null
  }
  return resolvePlaneWorkItemUuid(client, value, projectId, workspaceId)
}

// Resolves an explicit id flag (identifier like "NETSA-74" OR a UUID) to the
// work item UUID that Plane's write routes require. getWorkItem accepts either
// form and returns the item with `.id` set to the UUID.
export async function resolvePlaneWorkItemUuid(
  client: RuntimeClient,
  requestedId: string,
  projectId: string,
  workspaceId: string | undefined
): Promise<string> {
  const response = await client.call<PlaneWorkItem | null>('plane.getWorkItem', {
    workItemId: requestedId,
    projectId,
    workspaceId
  })
  if (!response.result) {
    throw new RuntimeClientError(
      'plane_work_item_not_found',
      `Plane work item ${requestedId} not found`
    )
  }
  return response.result.id
}

// Re-exported from its own module so the existing import sites keep working
// while both files stay under the per-file line cap.
export { readPlaneBody } from './plane-body-input'

const PLANE_LIST_FILTERS: readonly PlaneWorkItemFilter[] = [
  'everything',
  'assigned',
  'created',
  'all',
  'done'
]
const PLANE_PRIORITIES: readonly PlaneWorkItemPriority[] = [
  'none',
  'low',
  'medium',
  'high',
  'urgent'
]

const PLANE_STATE_GROUPS: readonly PlaneStateGroup[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled'
]

export function getPlaneStateGroupFlag(
  flags: Map<string, string | boolean>,
  name: string
): PlaneStateGroup {
  const value = getRequiredStringFlag(flags, name).toLocaleLowerCase()
  if ((PLANE_STATE_GROUPS as readonly string[]).includes(value)) {
    return value as PlaneStateGroup
  }
  throw new RuntimeClientError(
    'invalid_argument',
    `--${name} must be backlog, unstarted, started, completed, or cancelled`
  )
}

export function getPlaneListFilter(flags: Map<string, string | boolean>): PlaneWorkItemFilter {
  const filter = getOptionalStringFlag(flags, 'filter') ?? 'assigned'
  if ((PLANE_LIST_FILTERS as readonly string[]).includes(filter)) {
    return filter as PlaneWorkItemFilter
  }
  throw new RuntimeClientError(
    'invalid_argument',
    '--filter must be everything, assigned, created, all, or done'
  )
}

export function getPlanePriorityFlag(
  flags: Map<string, string | boolean>,
  name: string
): PlaneWorkItemPriority {
  const value = getRequiredStringFlag(flags, name).toLocaleLowerCase()
  if ((PLANE_PRIORITIES as readonly string[]).includes(value)) {
    return value as PlaneWorkItemPriority
  }
  throw new RuntimeClientError(
    'invalid_argument',
    `--${name} must be none, low, medium, high, or urgent`
  )
}

// Plane writes are always workspace-scoped to a single connection; `all` is a
// read-only fan-out selector, so reject it on writes (mirrors Linear).
export function rejectAllWorkspaceForPlaneWrite(flags: Map<string, string | boolean>): void {
  if (getOptionalStringFlag(flags, 'workspace') === 'all') {
    throw new RuntimeClientError(
      'plane_invalid_workspace',
      '--workspace all is not valid for Plane writes'
    )
  }
}

// Resolves a state name or id to a concrete state id against the project's
// state list. Ids match directly; names must match exactly one state
// case-insensitively, otherwise the ambiguity is surfaced rather than guessed.
export function resolvePlaneStateId(states: PlaneState[], input: string): string {
  const byId = states.find((state) => state.id === input)
  if (byId) {
    return byId.id
  }
  const normalized = input.trim().toLocaleLowerCase()
  const matches = states.filter((state) => state.name.toLocaleLowerCase() === normalized)
  if (matches.length === 1) {
    return matches[0].id
  }
  if (matches.length === 0) {
    throw new RuntimeClientError(
      'plane_invalid_state',
      `No Plane state matches "${input}". Available: ${states.map((state) => state.name).join(', ') || 'none'}`
    )
  }
  throw new RuntimeClientError(
    'plane_invalid_state',
    `Multiple Plane states match "${input}"; pass a state id instead`
  )
}

// Plane write RPCs resolve to a {ok:false,error} result instead of an RPC-level
// failure, so surface that as a CLI error to exit non-zero and print the reason.
export function throwOnPlaneMutationFailure(result: PlaneMutationResult): void {
  if (!result.ok) {
    throw new RuntimeClientError('plane_write_failed', result.error)
  }
}

// State create/update return the mapped state on success; surface a failure as
// a CLI error and otherwise hand back the state so the caller can echo it.
export function unwrapPlaneStateMutation(result: PlaneStateMutationResult): PlaneState {
  if (!result.ok) {
    throw new RuntimeClientError('plane_write_failed', result.error)
  }
  return result.state
}

// Work-item create returns id/identifier/url on success; surface a failure as
// a CLI error and otherwise hand back the created item so the caller can echo it.
export function unwrapPlaneCreateMutation(result: PlaneCreateWorkItemResult): PlaneCreatedWorkItem {
  if (!result.ok) {
    throw new RuntimeClientError('plane_write_failed', result.error)
  }
  return result
}

// Link create returns the created link on success; surface a failure as a CLI
// error and otherwise hand back the link so the caller can echo it.
export function unwrapPlaneLinkMutation(result: PlaneLinkMutationResult): PlaneWorkItemLink {
  if (!result.ok) {
    throw new RuntimeClientError('plane_write_failed', result.error)
  }
  return result.link
}

// Label create returns the created label on success; surface a failure as a
// CLI error and otherwise hand back the label so the caller can echo it.
export function unwrapPlaneLabelMutation(result: PlaneLabelMutationResult): PlaneLabel {
  if (!result.ok) {
    throw new RuntimeClientError('plane_write_failed', result.error)
  }
  return result.label
}
