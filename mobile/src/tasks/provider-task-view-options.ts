import type { PickerOption } from '../components/PickerModal'
import type { ProviderTaskGroupBy, ProviderTaskOrderBy } from './linear-mobile-issue-grouping'

/** Plane has no team: its board is one project, so `team` is never offered there. */
export type PlaneTaskGroupBy = Exclude<ProviderTaskGroupBy, 'team'>

export const PROVIDER_TASK_GROUP_OPTIONS: PickerOption<ProviderTaskGroupBy>[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'team', label: 'Team' }
]

export const PROVIDER_TASK_ORDER_OPTIONS: PickerOption<ProviderTaskOrderBy>[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'updated', label: 'Updated' },
  { value: 'identifier', label: 'Identifier' }
]

function isPlaneTaskGroupOption(
  option: PickerOption<ProviderTaskGroupBy>
): option is PickerOption<PlaneTaskGroupBy> {
  return option.value !== 'team'
}

export const PLANE_TASK_GROUP_OPTIONS: PickerOption<PlaneTaskGroupBy>[] =
  PROVIDER_TASK_GROUP_OPTIONS.filter(isPlaneTaskGroupOption)
