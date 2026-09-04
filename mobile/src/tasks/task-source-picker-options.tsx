import type { PlaneWorkItemFilter } from '../../../src/shared/plane-types'
import { TaskProviderLogo } from '../components/TaskProviderLogo'
import type { PickerOption } from '../components/PickerModal'
import { colors } from '../theme/mobile-theme'
import type { TaskProvider } from './mobile-task-providers'

function providerIcon(provider: TaskProvider): (selected: boolean) => React.JSX.Element {
  return (selected) => (
    <TaskProviderLogo
      provider={provider}
      size={16}
      color={selected ? colors.textPrimary : colors.textSecondary}
    />
  )
}

export const TASK_PROVIDER_OPTIONS: PickerOption<TaskProvider>[] = [
  {
    value: 'github',
    label: 'GitHub',
    subtitle: 'Issues and pull requests',
    renderIcon: providerIcon('github')
  },
  {
    value: 'gitlab',
    label: 'GitLab',
    subtitle: 'Issues and merge requests',
    renderIcon: providerIcon('gitlab')
  },
  {
    value: 'linear',
    label: 'Linear',
    subtitle: 'Assigned and team issues',
    renderIcon: providerIcon('linear')
  },
  {
    value: 'plane',
    label: 'Plane',
    subtitle: 'Work items across projects',
    renderIcon: providerIcon('plane')
  }
]

export const PLANE_FILTER_OPTIONS: PickerOption<PlaneWorkItemFilter>[] = [
  { value: 'all', label: 'All', subtitle: 'Open work items in scope' },
  { value: 'assigned', label: 'My Work Items', subtitle: 'Work items assigned to you' },
  { value: 'created', label: 'Created', subtitle: 'Work items you created' },
  { value: 'done', label: 'Done', subtitle: 'Recently completed work items' },
  { value: 'everything', label: 'Everything', subtitle: 'Any state, including archived states' }
]

const PLANE_FILTERS = new Set<PlaneWorkItemFilter>(
  PLANE_FILTER_OPTIONS.map((option) => option.value)
)

export function normalizePlaneFilter(value: unknown): PlaneWorkItemFilter {
  return PLANE_FILTERS.has(value as PlaneWorkItemFilter) ? (value as PlaneWorkItemFilter) : 'all'
}
