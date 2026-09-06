import type { PlaneWorkItemPriority } from '../../../src/shared/plane-types'
import { colors } from '../theme/mobile-theme'
import type { ProviderTaskGrouping } from './linear-mobile-issue-grouping'
import { getPlanePriorityRank, type PlaneMobileWorkItem } from './plane-mobile-work-item-read'
import { PLANE_PRIORITY_LABELS } from './plane-priority-label'

/** No `team`: a Plane board is one project, and the Plane menu never offers that grouping. */
export const PLANE_GROUPING: ProviderTaskGrouping<PlaneMobileWorkItem, PlaneWorkItemPriority> = {
  identifier: (item) => item.identifier,
  updatedAt: (item) => item.updatedAt,
  priority: (item) => item.priority,
  priorityLabel: (priority) => PLANE_PRIORITY_LABELS[priority],
  priorityRank: (priority) => getPlanePriorityRank(priority),
  priorityColor: (priority) => (priority === 'urgent' ? colors.statusRed : colors.accentBlue),
  status: (item) => ({
    key: `status:${item.state.id}`,
    label: item.state.name || item.state.group,
    color: item.state.color || colors.textMuted
  }),
  assignee: (item) => {
    const [first] = item.assignees
    return first ? { key: `assignee:${first.id}`, label: first.displayName } : null
  },
  defaultColor: colors.accentBlue
}
