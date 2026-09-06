import { colors } from '../theme/mobile-theme'
import {
  compareProviderTasks,
  groupProviderTasks,
  type ProviderTaskOrderBy
} from '../tasks/linear-mobile-issue-grouping'
import { PLANE_GROUPING } from '../tasks/plane-mobile-work-item-grouping'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { ProviderTaskBoardSection } from '../tasks/provider-task-board'
import type { PlaneTaskGroupBy } from '../tasks/provider-task-view-options'
import type { PlaneBoardColumn } from './plane-board-columns'

/** A state's colour when Plane sent none: its group is what the dot can still say. */
export function planeStateGroupColor(group: string): string {
  if (group === 'started') {
    return colors.statusAmber
  }
  if (group === 'completed') {
    return colors.statusGreen
  }
  if (group === 'cancelled') {
    return colors.statusRed
  }
  return colors.textMuted
}

// Status keeps the hook's columns (empty ones, state order); groupProviderTasks would drop and reorder them.
export function planeBoardSections(
  columns: readonly PlaneBoardColumn[],
  groupBy: PlaneTaskGroupBy,
  orderBy: ProviderTaskOrderBy
): ProviderTaskBoardSection<PlaneMobileWorkItem>[] {
  if (groupBy === 'none' || groupBy === 'status') {
    return columns.map((column) => ({
      key: column.stateId,
      label: column.name,
      color: column.color ?? planeStateGroupColor(column.group),
      items: [...column.items].sort((a, b) => compareProviderTasks(a, b, orderBy, PLANE_GROUPING))
    }))
  }
  const items = columns.flatMap((column) => column.items)
  return groupProviderTasks(items, groupBy, orderBy, PLANE_GROUPING)
}
