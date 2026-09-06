import type { LinearMobileIssue as LinearIssue } from './linear-mobile-issue-read'
import { colors } from '../theme/mobile-theme'
import { taskTime } from './task-updated-at-time'

export type ProviderTaskGroupBy = 'none' | 'status' | 'assignee' | 'priority' | 'team'
export type ProviderTaskOrderBy = 'priority' | 'updated' | 'identifier'
export type LinearGroupBy = ProviderTaskGroupBy
export type LinearOrderBy = ProviderTaskOrderBy
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

export type ProviderTaskGrouping<Item, Priority> = {
  identifier: (item: Item) => string
  updatedAt: (item: Item) => string
  priority: (item: Item) => Priority
  priorityLabel: (priority: Priority) => string
  priorityRank: (priority: Priority) => number
  priorityColor: (priority: Priority) => string
  status: (item: Item) => { key: string; label: string; color: string }
  assignee: (item: Item) => { key: string; label: string } | null
  team?: (item: Item) => { key: string; label: string; color: string }
  defaultColor: string
}

export type ProviderTaskSection<Item> = {
  key: string
  label: string
  color: string
  items: Item[]
}

export function createProviderPriorityScale<Priority extends PropertyKey>(
  labels: Readonly<Partial<Record<Priority, string>>>,
  ranks: Readonly<Partial<Record<Priority, number>>>,
  fallbackLabel: (priority: Priority) => string,
  fallbackRank: (priority: Priority) => number
) {
  return {
    label: (priority: Priority): string => labels[priority] ?? fallbackLabel(priority),
    rank: (priority: Priority): number => ranks[priority] ?? fallbackRank(priority)
  }
}

export function compareProviderTasks<Item, Priority>(
  a: Item,
  b: Item,
  orderBy: ProviderTaskOrderBy,
  provider: ProviderTaskGrouping<Item, Priority>
): number {
  if (orderBy === 'updated') {
    return taskTime(provider.updatedAt(b)) - taskTime(provider.updatedAt(a))
  }
  if (orderBy === 'identifier') {
    return provider
      .identifier(a)
      .localeCompare(provider.identifier(b), undefined, { numeric: true })
  }
  const priorityDelta =
    provider.priorityRank(provider.priority(a)) - provider.priorityRank(provider.priority(b))
  return priorityDelta || taskTime(provider.updatedAt(b)) - taskTime(provider.updatedAt(a))
}

function getProviderTaskGroup<Item, Priority>(
  item: Item,
  groupBy: ProviderTaskGroupBy,
  provider: ProviderTaskGrouping<Item, Priority>
): { key: string; label: string; color: string } {
  if (groupBy === 'status') {
    return provider.status(item)
  }
  if (groupBy === 'assignee') {
    const assignee = provider.assignee(item)
    return assignee
      ? { ...assignee, color: provider.defaultColor }
      : { key: 'assignee:unassigned', label: 'Unassigned', color: provider.defaultColor }
  }
  if (groupBy === 'priority') {
    const priority = provider.priority(item)
    return {
      key: `priority:${String(priority)}`,
      label: provider.priorityLabel(priority),
      color: provider.priorityColor(priority)
    }
  }
  if (groupBy === 'team' && provider.team) {
    return provider.team(item)
  }
  return { key: 'all', label: 'Issues', color: provider.defaultColor }
}

export function groupProviderTasks<Item, Priority>(
  items: readonly Item[],
  groupBy: ProviderTaskGroupBy,
  orderBy: ProviderTaskOrderBy,
  provider: ProviderTaskGrouping<Item, Priority>
): ProviderTaskSection<Item>[] {
  const sorted = [...items].sort((a, b) => compareProviderTasks(a, b, orderBy, provider))
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'Issues', color: provider.defaultColor, items: sorted }]
  }
  const sections = new Map<string, ProviderTaskSection<Item>>()
  for (const item of sorted) {
    const group = getProviderTaskGroup(item, groupBy, provider)
    const section = sections.get(group.key)
    if (section) {
      section.items.push(item)
    } else {
      sections.set(group.key, { ...group, items: [item] })
    }
  }
  return [...sections.values()]
}

const LINEAR_PRIORITY_SCALE = createProviderPriorityScale(
  LINEAR_PRIORITY_LABELS,
  { 0: 5, 1: 1, 2: 2, 3: 3, 4: 4 },
  (priority) => `P${priority}`,
  (priority) => priority
)

const LINEAR_GROUPING: ProviderTaskGrouping<LinearIssue, number> = {
  identifier: (issue) => issue.identifier,
  updatedAt: (issue) => issue.updatedAt,
  priority: (issue) => issue.priority,
  priorityLabel: (priority) => LINEAR_PRIORITY_SCALE.label(priority),
  priorityRank: (priority) => LINEAR_PRIORITY_SCALE.rank(priority),
  priorityColor: (priority) => (priority === 1 ? colors.statusRed : colors.accentBlue),
  status: (issue) => ({
    key: `status:${issue.state.name}`,
    label: issue.state.name,
    color: issue.state.color
  }),
  assignee: (issue) =>
    issue.assignee
      ? {
          key: `assignee:${issue.assignee.id ?? issue.assignee.displayName}`,
          label: issue.assignee.displayName
        }
      : null,
  team: (issue) => ({
    key: `team:${issue.team.id}`,
    label: issue.team.name,
    color: issue.state.color
  }),
  defaultColor: colors.accentBlue
}

export function getLinearPriorityLabel(priority: number): string {
  return LINEAR_PRIORITY_SCALE.label(priority)
}

export function getLinearPriorityRank(priority: number): number {
  return LINEAR_PRIORITY_SCALE.rank(priority)
}

export function compareLinearIssues(
  a: LinearIssue,
  b: LinearIssue,
  orderBy: LinearOrderBy
): number {
  return compareProviderTasks(a, b, orderBy, LINEAR_GROUPING)
}

export function groupLinearIssues(
  issues: LinearIssue[],
  groupBy: LinearGroupBy,
  orderBy: LinearOrderBy
): LinearIssueSection[] {
  return groupProviderTasks(issues, groupBy, orderBy, LINEAR_GROUPING).map(
    ({ items, ...section }) => ({ ...section, issues: items })
  )
}
