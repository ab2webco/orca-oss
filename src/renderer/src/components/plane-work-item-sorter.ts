import { translate } from '@/i18n/i18n'
import type { PlaneWorkItem, PlaneWorkItemPriority } from '../../../shared/plane-types'

export type PlaneWorkItemSortColumn =
  | 'identifier'
  | 'title'
  | 'state'
  | 'priority'
  | 'assignee'
  | 'updated'

export type PlaneWorkItemSortDirection = 'asc' | 'desc'

// Why: Plane's priority set is a small static enum (unlike Jira, which fetches
// a per-site priority scheme), so a fixed weight table is all ordering needs.
const PLANE_PRIORITY_ORDER: Record<PlaneWorkItemPriority, number> = {
  urgent: 99,
  high: 75,
  medium: 50,
  low: 25,
  none: 0
}

export function getPlanePriorityWeight(priority?: PlaneWorkItemPriority): number {
  return PLANE_PRIORITY_ORDER[priority ?? 'none']
}

export function getPlanePriorityLabel(priority?: PlaneWorkItemPriority): string {
  switch (priority) {
    case 'urgent':
      return translate('auto.components.TaskPage.f373ab1a4f', 'Urgent')
    case 'high':
      return translate('auto.components.TaskPage.345b169f1f', 'High')
    case 'medium':
      return translate('auto.components.TaskPage.7fd59c18d8', 'Medium')
    case 'low':
      return translate('auto.components.TaskPage.69591944e7', 'Low')
    case 'none':
    case undefined:
      return translate('auto.components.TaskPage.713179dfdc', 'No priority')
  }
}

function planeAssigneeSortName(item: PlaneWorkItem): string {
  return item.assignees?.[0]?.displayName ?? ''
}

export function sortPlaneWorkItems(
  items: readonly PlaneWorkItem[],
  orderBy: PlaneWorkItemSortColumn,
  orderDirection: PlaneWorkItemSortDirection
): PlaneWorkItem[] {
  return [...items].sort((a, b) => {
    let comparison = 0
    if (orderBy === 'identifier') {
      comparison = a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
    } else if (orderBy === 'title') {
      comparison = a.title.localeCompare(b.title)
    } else if (orderBy === 'state') {
      comparison = 0
    } else if (orderBy === 'priority') {
      comparison = getPlanePriorityWeight(a.priority) - getPlanePriorityWeight(b.priority)
    } else if (orderBy === 'assignee') {
      comparison = planeAssigneeSortName(a).localeCompare(planeAssigneeSortName(b))
    } else if (orderBy === 'updated') {
      comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    }
    return orderDirection === 'asc' ? comparison : -comparison
  })
}
