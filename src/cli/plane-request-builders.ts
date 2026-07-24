import { isAbsolute, join } from 'node:path'
import type {
  PlaneCreateWorkItemResult,
  PlaneMutationResult,
  PlaneState,
  PlaneStateGroup,
  PlaneStateMutationResult,
  PlaneWorkItemFilter,
  PlaneWorkItemPriority
} from '../shared/plane-types'

export type PlaneCreatedWorkItem = Extract<PlaneCreateWorkItemResult, { ok: true }>
import {
  getOptionalStringFlag,
  getRequiredStringFlag,
  getRequiredStringFlagAllowingEmpty
} from './flags'
import { RuntimeClientError } from './runtime-client'
import {
  NodeReadableTextTooLargeError,
  readNodeReadableTextWithinLimit
} from '../shared/node-readable-text'
import {
  NodeFileReadTooLargeError,
  readNodeFileWithinLimit
} from '../shared/node-bounded-file-reader'

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

const PLANE_WRITE_BODY_CAP = 50_000
const PLANE_WRITE_BODY_MAX_BYTES = PLANE_WRITE_BODY_CAP * 4

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

export function readPlaneBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  options: { required: true }
): Promise<string>
export function readPlaneBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  options: { required: false }
): Promise<string | undefined>
export async function readPlaneBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  options: { required: boolean }
): Promise<string | undefined> {
  const hasBody = flags.has('body')
  const hasBodyFile = flags.has('body-file')
  if (hasBody && hasBodyFile) {
    throw new RuntimeClientError('invalid_argument', 'Use either --body or --body-file, not both')
  }
  if (!hasBody && !hasBodyFile) {
    if (options.required) {
      throw new RuntimeClientError('invalid_argument', 'Missing --body or --body-file')
    }
    return undefined
  }
  const body = hasBody
    ? getRequiredStringFlagAllowingEmpty(flags, 'body')
    : await readPlaneBodyFile(getRequiredStringFlag(flags, 'body-file'), cwd)
  if (body.length > PLANE_WRITE_BODY_CAP) {
    throw planeBodyTooLargeError()
  }
  return body
}

async function readPlaneBodyFile(path: string, cwd: string): Promise<string> {
  if (path !== '-') {
    try {
      const { buffer } = await readNodeFileWithinLimit(
        isAbsolute(path) ? path : join(cwd, path),
        PLANE_WRITE_BODY_MAX_BYTES
      )
      return buffer.toString('utf8')
    } catch (error) {
      if (error instanceof NodeFileReadTooLargeError) {
        throw planeBodyTooLargeError()
      }
      throw error
    }
  }
  if (process.stdin.isTTY) {
    throw new RuntimeClientError('invalid_argument', 'stdin body requested but stdin is a TTY')
  }
  try {
    return await readNodeReadableTextWithinLimit(process.stdin, PLANE_WRITE_BODY_MAX_BYTES)
  } catch (error) {
    if (error instanceof NodeReadableTextTooLargeError) {
      throw planeBodyTooLargeError()
    }
    throw error
  }
}

function planeBodyTooLargeError(): RuntimeClientError {
  return new RuntimeClientError(
    'plane_body_too_large',
    `Plane body must be at most ${PLANE_WRITE_BODY_CAP} characters`
  )
}
