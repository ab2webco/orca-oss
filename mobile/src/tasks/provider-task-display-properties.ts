import type { PickerOption } from '../components/PickerModal'

export type ProviderTaskDisplayProperty =
  | 'state'
  | 'priority'
  | 'assignee'
  | 'team'
  | 'project'
  | 'labels'
  | 'updated'

/** Linear has no project: its issues scope by team. */
export type LinearTaskDisplayProperty = Exclude<ProviderTaskDisplayProperty, 'project'>

/** Plane has no team (its board is one project) and its mobile rows carry only
 *  `labelIds`, no label names — there is no `plane.listLabels` RPC on mobile. */
export type PlaneTaskDisplayProperty = Exclude<ProviderTaskDisplayProperty, 'team' | 'labels'>

export const PROVIDER_TASK_DISPLAY_OPTIONS: PickerOption<ProviderTaskDisplayProperty>[] = [
  { value: 'state', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'team', label: 'Team' },
  { value: 'project', label: 'Project' },
  { value: 'labels', label: 'Labels' },
  { value: 'updated', label: 'Updated' }
]

function isLinearTaskDisplayOption(
  option: PickerOption<ProviderTaskDisplayProperty>
): option is PickerOption<LinearTaskDisplayProperty> {
  return option.value !== 'project'
}

function isPlaneTaskDisplayOption(
  option: PickerOption<ProviderTaskDisplayProperty>
): option is PickerOption<PlaneTaskDisplayProperty> {
  return option.value !== 'team' && option.value !== 'labels'
}

export const LINEAR_TASK_DISPLAY_OPTIONS: PickerOption<LinearTaskDisplayProperty>[] =
  PROVIDER_TASK_DISPLAY_OPTIONS.filter(isLinearTaskDisplayOption)

export const PLANE_TASK_DISPLAY_OPTIONS: PickerOption<PlaneTaskDisplayProperty>[] =
  PROVIDER_TASK_DISPLAY_OPTIONS.filter(isPlaneTaskDisplayOption)

export const DEFAULT_LINEAR_TASK_DISPLAY_PROPERTIES: readonly LinearTaskDisplayProperty[] =
  LINEAR_TASK_DISPLAY_OPTIONS.map((option) => option.value)

export const DEFAULT_PLANE_TASK_DISPLAY_PROPERTIES: readonly PlaneTaskDisplayProperty[] =
  PLANE_TASK_DISPLAY_OPTIONS.map((option) => option.value)

export function toggleTaskDisplayProperty<T extends ProviderTaskDisplayProperty>(
  current: ReadonlySet<T>,
  property: T
): Set<T> {
  const next = new Set(current)
  if (next.has(property)) {
    next.delete(property)
  } else {
    next.add(property)
  }
  return next
}
