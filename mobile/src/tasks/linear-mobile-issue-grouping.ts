import type { LinearMobileIssue as LinearIssue } from './linear-mobile-issue-read'
import { colors } from '../theme/mobile-theme'
import { taskTime } from './task-updated-at-time'

export type LinearGroupBy = 'none' | 'status' | 'assignee' | 'priority' | 'team'
export type LinearOrderBy = 'priority' | 'updated' | 'identifier'
export type LinearIssueSection = {
  key: string
  label: string
  color: string
  issues: LinearIssue[]
}

const LINEAR_PRIORITY_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low'
}

export function getLinearPriorityLabel(priority: number): string {
  return LINEAR_PRIORITY_LABELS[priority] ?? `P${priority}`
}

export function getLinearPriorityRank(priority: number): number {
  return priority === 0 ? 5 : priority
}

export function compareLinearIssues(
  a: LinearIssue,
  b: LinearIssue,
  orderBy: LinearOrderBy
): number {
  if (orderBy === 'updated') {
    return taskTime(b.updatedAt) - taskTime(a.updatedAt)
  }
  if (orderBy === 'identifier') {
    return a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
  }
  const priorityDelta = getLinearPriorityRank(a.priority) - getLinearPriorityRank(b.priority)
  return priorityDelta || taskTime(b.updatedAt) - taskTime(a.updatedAt)
}

function getLinearIssueGroup(
  issue: LinearIssue,
  groupBy: LinearGroupBy
): { key: string; label: string; color: string } {
  if (groupBy === 'status') {
    return { key: `status:${issue.state.name}`, label: issue.state.name, color: issue.state.color }
  }
  if (groupBy === 'assignee') {
    return {
      key: `assignee:${issue.assignee?.id ?? issue.assignee?.displayName ?? 'unassigned'}`,
      label: issue.assignee?.displayName ?? 'Unassigned',
      color: colors.accentBlue
    }
  }
  if (groupBy === 'priority') {
    return {
      key: `priority:${issue.priority}`,
      label: getLinearPriorityLabel(issue.priority),
      color: issue.priority === 1 ? colors.statusRed : colors.accentBlue
    }
  }
  if (groupBy === 'team') {
    return { key: `team:${issue.team.id}`, label: issue.team.name, color: issue.state.color }
  }
  return { key: 'all', label: 'Issues', color: colors.accentBlue }
}

export function groupLinearIssues(
  issues: LinearIssue[],
  groupBy: LinearGroupBy,
  orderBy: LinearOrderBy
): LinearIssueSection[] {
  const sorted = [...issues].sort((a, b) => compareLinearIssues(a, b, orderBy))
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'Issues', color: colors.accentBlue, issues: sorted }]
  }
  const sections = new Map<string, LinearIssueSection>()
  for (const issue of sorted) {
    const group = getLinearIssueGroup(issue, groupBy)
    const section = sections.get(group.key)
    if (section) {
      section.issues.push(issue)
    } else {
      sections.set(group.key, { ...group, issues: [issue] })
    }
  }
  return [...sections.values()]
}
