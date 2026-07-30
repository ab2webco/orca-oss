import type {
  PlaneComment,
  PlaneLabel,
  PlaneProject,
  PlaneState,
  PlaneUser,
  PlaneWorkItem,
  PlaneWorkItemLink,
  PlaneWorkItemRelation
} from '../shared/plane-types'
import type { PlaneCreatedWorkItem } from './plane-request-builders'

// Combined view for `plane issue`: the work item plus optionally its comments,
// fetched by the handler from two RPC calls (getWorkItem + listWorkItemComments).
export type PlaneIssueView = {
  workItem: PlaneWorkItem
  comments?: PlaneComment[]
  /** Present when `--children` was passed: the work item's direct sub-issues. */
  children?: PlaneWorkItem[]
}

function assigneeNames(workItem: PlaneWorkItem): string {
  const assignees = workItem.assignees ?? []
  if (assignees.length === 0) {
    return 'unassigned'
  }
  return assignees.map((assignee) => assignee.displayName).join(', ')
}

export function formatPlaneWorkItem(view: PlaneIssueView): string {
  const item = view.workItem
  const lines = [
    `${item.identifier} ${item.title}`,
    `URL: ${item.url}`,
    `State: ${item.state?.name ?? 'unknown'}`,
    `Assignees: ${assigneeNames(item)}`,
    `Project: ${item.project?.name ?? 'none'}`,
    `Priority: ${item.priority ?? 'none'}`
  ]
  if (item.labels.length > 0) {
    lines.push(`Labels: ${item.labels.join(', ')}`)
  }
  // Why only when set: printing "Start: none" on every item that never had a
  // schedule would bury the ones that do.
  if (item.startDate) {
    lines.push(`Start: ${item.startDate}`)
  }
  if (item.targetDate) {
    lines.push(`Target: ${item.targetDate}`)
  }
  if (item.estimatePoint) {
    lines.push(`Estimate: ${item.estimatePoint}`)
  }
  lines.push(`Updated: ${item.updatedAt}`)
  if (view.children) {
    lines.push(`Children: ${view.children.length}`)
    for (const child of view.children) {
      lines.push(`  ${formatWorkItemRow(child)}`)
    }
  }
  if (view.comments) {
    lines.push(`Comments: ${view.comments.length}`)
    for (const comment of view.comments) {
      lines.push(formatPlaneCommentRow(comment))
    }
  }
  return lines.join('\n')
}

function formatPlaneCommentRow(comment: PlaneComment): string {
  const author = comment.user?.displayName ?? 'unknown'
  const firstLine = comment.body.split('\n', 1)[0] ?? ''
  return `  - ${author} (${comment.createdAt}): ${firstLine}`
}

function formatWorkItemRow(item: PlaneWorkItem): string {
  const state = item.state?.name ?? 'unknown'
  return `${item.identifier.padEnd(12)} ${state.padEnd(16)} ${assigneeNames(item).padEnd(20)} ${item.title}`
}

export function formatPlaneList(items: PlaneWorkItem[]): string {
  if (items.length === 0) {
    return 'No Plane work items found.'
  }
  return items.map(formatWorkItemRow).join('\n')
}

export function formatPlaneSearch(items: PlaneWorkItem[]): string {
  if (items.length === 0) {
    return 'No Plane work items found.'
  }
  return items.map(formatWorkItemRow).join('\n')
}

function formatProjectRow(project: PlaneProject): string {
  return `${project.identifier.padEnd(12)} ${project.name.padEnd(28)} ${project.id}`
}

export function formatPlaneProjectList(projects: PlaneProject[]): string {
  if (projects.length === 0) {
    return 'No Plane projects found.'
  }
  // Why: a flat list gave a multi-workspace answer no workspace attribution, so
  // it read as a single-workspace one; group once 2+ workspaces are present and
  // keep the single-workspace output byte-identical. Keyed on workspaceId, not
  // the slug — identity is (baseUrl, slug), so two hosts can share a slug and
  // must not collapse into one header (ORCA-139).
  const groups = new Map<string, PlaneProject[]>()
  for (const project of projects) {
    const key = project.workspaceId ?? project.workspaceSlug ?? ''
    const group = groups.get(key)
    if (group) {
      group.push(project)
    } else {
      groups.set(key, [project])
    }
  }
  if (groups.size < 2) {
    return projects.map(formatProjectRow).join('\n')
  }
  return [...groups]
    .map(([workspaceId, group]) =>
      [
        `Workspace ${group[0].workspaceSlug ?? 'unknown'} ${workspaceId} (${group.length})`,
        ...group.map((project) => `  ${formatProjectRow(project)}`)
      ].join('\n')
    )
    .join('\n\n')
}

// Leads with the id: the caller's next command is almost always --project <id>.
export function formatPlaneProjectMutation(project: PlaneProject): string {
  const workspace = project.workspaceSlug ? ` in ${project.workspaceSlug}` : ''
  return `${project.id}  ${project.identifier}  ${project.name}${workspace}`
}

export function formatPlaneStates(states: PlaneState[]): string {
  if (states.length === 0) {
    return 'No Plane states found.'
  }
  return states
    .map((state) => `${state.name.padEnd(24)} ${state.group.padEnd(12)} ${state.id}`)
    .join('\n')
}

export function formatPlaneLabels(labels: PlaneLabel[]): string {
  if (labels.length === 0) {
    return 'No Plane labels found.'
  }
  return labels.map((label) => `${label.name.padEnd(24)} ${label.id}`).join('\n')
}

export function formatPlaneMembers(users: PlaneUser[]): string {
  if (users.length === 0) {
    return 'No Plane members found.'
  }
  return users.map((user) => `${(user.displayName ?? 'unknown').padEnd(24)} ${user.id}`).join('\n')
}

export function formatPlaneStateMutation(state: PlaneState): string {
  return `Saved column ${state.name} (${state.group}) ${state.id}.`
}

export function formatPlaneCreate(created: PlaneCreatedWorkItem): string {
  return [`Created ${created.identifier} (${created.id})`, `URL: ${created.url}`].join('\n')
}

export function formatPlaneComments(comments: PlaneComment[]): string {
  if (comments.length === 0) {
    return 'No comments.'
  }
  return comments.map((comment) => `${comment.id}\n${formatPlaneCommentRow(comment)}`).join('\n')
}

export function formatPlaneRelations(relations: PlaneWorkItemRelation[]): string {
  if (relations.length === 0) {
    return 'No relations.'
  }
  return relations
    .map((relation) => {
      const label = relation.name ?? relation.relatedWorkItemId
      return `${relation.relationType.padEnd(14)} ${label.padEnd(28)} ${relation.relatedWorkItemId}`
    })
    .join('\n')
}

export function formatPlaneLinks(links: PlaneWorkItemLink[]): string {
  if (links.length === 0) {
    return 'No links.'
  }
  return links
    .map((link) => `${(link.title ?? '').padEnd(28)} ${link.url}${link.id ? ` (${link.id})` : ''}`)
    .join('\n')
}

export function formatPlaneLabelCreated(label: PlaneLabel): string {
  return `Created label ${label.name} (${label.id}).`
}
