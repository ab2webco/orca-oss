import type { PlaneWorkItemPriority } from '../../../src/shared/plane-types'
import {
  groupProviderTasks,
  compareProviderTasks,
  type ProviderTaskGrouping,
  type ProviderTaskOrderBy,
  type ProviderTaskSection
} from './linear-mobile-issue-grouping'
import type { PlaneTaskItem } from './plane-mobile-task-list'
import { PLANE_GROUPING } from './plane-mobile-work-item-grouping'
import type { PlaneTaskGroupBy } from './provider-task-view-options'

/** The board's grouping, read through a list row. Derived rather than written a second
 *  time: two hand-written copies drift, and the board and the list would then disagree
 *  on what a group even is. */
const PLANE_ROW_GROUPING: ProviderTaskGrouping<PlaneTaskItem, PlaneWorkItemPriority> = {
  identifier: (row) => PLANE_GROUPING.identifier(row.source),
  updatedAt: (row) => PLANE_GROUPING.updatedAt(row.source),
  priority: (row) => PLANE_GROUPING.priority(row.source),
  priorityLabel: PLANE_GROUPING.priorityLabel,
  priorityRank: PLANE_GROUPING.priorityRank,
  priorityColor: PLANE_GROUPING.priorityColor,
  status: (row) => PLANE_GROUPING.status(row.source),
  assignee: (row) => PLANE_GROUPING.assignee(row.source),
  defaultColor: PLANE_GROUPING.defaultColor
}

/** The list's rows under the same Group and Order the board uses: one control, two views.
 *  Ungrouped is one unlabelled run, so the list draws rows and no headers. */
export function planeListSections(
  rows: readonly PlaneTaskItem[],
  groupBy: PlaneTaskGroupBy,
  orderBy: ProviderTaskOrderBy
): ProviderTaskSection<PlaneTaskItem>[] {
  if (groupBy === 'none') {
    return [
      {
        key: 'all',
        label: '',
        color: PLANE_ROW_GROUPING.defaultColor,
        items: [...rows].sort((a, b) => compareProviderTasks(a, b, orderBy, PLANE_ROW_GROUPING))
      }
    ]
  }
  return groupProviderTasks(rows, groupBy, orderBy, PLANE_ROW_GROUPING)
}
