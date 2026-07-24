import type {
  PlaneComment,
  PlaneLabel,
  PlaneProject,
  PlaneState,
  PlaneUser,
  PlaneWorkItem
} from '../shared/plane-types'
import type { PlaneCreatedWorkItem } from './plane-request-builders'

// Combined view for `plane issue`: the work item plus optionally its comments,
// fetched by the handler from two RPC calls (getWorkItem + listWorkItemComments).
export type PlaneIssueView = {
  workItem: PlaneWorkItem
  comments?: PlaneComment[]
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
  lines.push(`Updated: ${item.updatedAt}`)
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

export function formatPlaneProjectList(projects: PlaneProject[]): string {
  if (projects.length === 0) {
    return 'No Plane projects found.'
  }
  return projects
    .map((project) => `${project.identifier.padEnd(12)} ${project.name.padEnd(28)} ${project.id}`)
    .join('\n')
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
