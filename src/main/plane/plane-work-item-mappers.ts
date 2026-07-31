// Plane snake_case -> PlaneWorkItem mapping, plus the pinned PQL strings for
// each built-in filter. Priority is a static enum here (unlike Jira's
// per-site fetch) since Plane's priority set never varies by workspace.
import { planeHtmlToMarkdown } from './plane-html-markdown'
import type {
  PlaneComment,
  PlaneLabel,
  PlaneProject,
  PlaneState,
  PlaneUser,
  PlaneWorkItem,
  PlaneWorkItemFilter,
  PlaneWorkItemPriority
} from '../../shared/plane-types'

type PlaneRecord = Record<string, unknown>

const PRIORITIES: readonly string[] = ['none', 'low', 'medium', 'high', 'urgent']

function asRecord(value: unknown): PlaneRecord {
  return value && typeof value === 'object' ? (value as PlaneRecord) : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asPriority(value: unknown): PlaneWorkItemPriority | undefined {
  return typeof value === 'string' && PRIORITIES.includes(value)
    ? (value as PlaneWorkItemPriority)
    : undefined
}

// Pinned exact strings: any drift here silently changes what "assigned to
// me" / "done" mean server-side, so the lock test compares these verbatim.
export function filterToPql(filter: PlaneWorkItemFilter): string | undefined {
  if (filter === 'assigned') {
    return 'assignee = currentUser() AND stateGroup IN openStates()'
  }
  if (filter === 'created') {
    return 'createdBy = currentUser() AND stateGroup IN openStates()'
  }
  if (filter === 'done') {
    return 'assignee = currentUser() AND stateGroup IN closedStates()'
  }
  return undefined
}

export function mapPlaneProject(
  raw: unknown,
  workspaceSlug?: string,
  workspaceId?: string
): PlaneProject {
  const project = asRecord(raw)
  const identifier = asString(project.identifier)
  return {
    id: asString(project.id),
    identifier,
    name: asString(project.name, identifier || 'Untitled project'),
    workspaceSlug,
    workspaceId,
    // Always a boolean, never the raw timestamp: consumers only branch on
    // archived-or-not, and an absent key reads as "unknown" (ORCA-140).
    archived: asString(project.archived_at).length > 0
  }
}

export function mapPlaneState(raw: unknown): PlaneState {
  const state = asRecord(raw)
  return {
    id: asString(state.id),
    name: asString(state.name, 'Unknown'),
    group: asString(state.group, 'backlog'),
    sequence: typeof state.sequence === 'number' ? state.sequence : undefined,
    color: asString(state.color) || undefined
  }
}

export function mapPlaneUser(raw: unknown): PlaneUser | undefined {
  const user = asRecord(raw)
  const id = asString(user.id)
  if (!id) {
    return undefined
  }
  const fullName = `${asString(user.first_name)} ${asString(user.last_name)}`.trim()
  return {
    id,
    displayName: asString(user.display_name) || fullName || asString(user.email) || 'Plane user',
    email: typeof user.email === 'string' ? user.email : undefined,
    avatarUrl: asString(user.avatar_url) || undefined
  }
}

// Project-members entries nest the user under `member` (alongside `role`),
// unlike workspace members which arrive flat. Prefer the nested user object
// and fall back to the flat record so both API shapes map identically.
export function mapPlaneProjectMember(raw: unknown): PlaneUser | undefined {
  const record = asRecord(raw)
  return mapPlaneUser(record.member ?? record)
}

export function mapPlaneLabel(raw: unknown): PlaneLabel {
  const label = asRecord(raw)
  return {
    id: asString(label.id),
    name: asString(label.name, 'Label'),
    color: asString(label.color) || undefined
  }
}

function mapAssignees(value: unknown): PlaneUser[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) =>
      typeof entry === 'string' ? { id: entry, displayName: entry } : mapPlaneUser(entry)
    )
    .filter((user): user is PlaneUser => !!user)
}

// Labels usually arrive as full expanded objects (expand=labels), but the
// API tolerates falling back to bare UUIDs; labelsById resolves those to a
// readable name instead of surfacing a raw UUID in the UI.
function mapLabelNames(value: unknown, labelsById: ReadonlyMap<string, string>): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((entry) =>
    typeof entry === 'string' ? (labelsById.get(entry) ?? entry) : mapPlaneLabel(entry).name
  )
}

// Label UUIDs, tolerating both the expanded-object form and the bare-UUID
// fallback, so incremental label edits can diff against the current id set.
function mapLabelIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry : mapPlaneLabel(entry).id))
    .filter((id) => id.length > 0)
}

function workItemUrl(baseUrl: string, workspaceSlug: string, identifier: string): string {
  // Plane's cloud API host (api.plane.so) is not the web app host
  // (app.plane.so); self-hosted instances typically serve both from the
  // same origin. Best-effort only -- not part of the Step 0 spike scope.
  const appOrigin = new URL(baseUrl).host === 'api.plane.so' ? 'https://app.plane.so' : baseUrl
  return `${appOrigin}/${encodeURIComponent(workspaceSlug)}/browse/${encodeURIComponent(identifier)}/`
}

export type MapPlaneWorkItemContext = {
  baseUrl: string
  workspaceSlug: string
  workspaceId?: string
  project: PlaneProject
  labelsById?: ReadonlyMap<string, string>
}

// `actor` per Plane's comment schema is the expanded creator object (same
// shape mapPlaneUser already expects); comments are never authored by a bare
// UUID the way assignees/labels can arrive.
export function mapPlaneComment(raw: unknown): PlaneComment {
  const comment = asRecord(raw)
  return {
    id: asString(comment.id),
    body: planeHtmlToMarkdown(asString(comment.comment_html)),
    createdAt: asString(comment.created_at, new Date().toISOString()),
    updatedAt: asString(comment.updated_at) || undefined,
    user: mapPlaneUser(comment.actor)
  }
}

export function mapPlaneWorkItem(raw: unknown, ctx: MapPlaneWorkItemContext): PlaneWorkItem {
  const item = asRecord(raw)
  const state = mapPlaneState(item.state)
  const sequenceId = asFiniteNumber(item.sequence_id)
  const identifier = `${ctx.project.identifier}-${sequenceId}`
  const parent = item.parent
  return {
    id: asString(item.id),
    identifier,
    sequenceId,
    workspaceSlug: ctx.workspaceSlug,
    workspaceId: ctx.workspaceId,
    title: asString(item.name, 'Untitled work item'),
    description: planeHtmlToMarkdown(asString(item.description_html)),
    url: workItemUrl(ctx.baseUrl, ctx.workspaceSlug, identifier),
    project: ctx.project,
    state,
    labels: mapLabelNames(item.labels, ctx.labelsById ?? new Map()),
    labelIds: mapLabelIds(item.labels),
    assignees: mapAssignees(item.assignees),
    priority: asPriority(item.priority),
    parentId: typeof parent === 'string' ? parent : null,
    // Why undefined and not '': these are optional in Plane, and an empty string
    // would render as a blank date rather than "not set".
    startDate: asString(item.start_date) || undefined,
    targetDate: asString(item.target_date) || undefined,
    estimatePoint: asString(item.estimate_point) || undefined,
    createdBy: asString(item.created_by) || undefined,
    updatedAt: asString(item.updated_at, new Date().toISOString()),
    createdAt: asString(item.created_at, new Date().toISOString())
  }
}
