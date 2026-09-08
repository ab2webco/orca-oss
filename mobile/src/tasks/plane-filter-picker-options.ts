import type { PlaneWorkItemFilter } from '../../../src/shared/plane-types'
import {
  DEFAULT_PLANE_WORK_ITEM_FILTER,
  PLANE_WORK_ITEM_FILTER_LABELS,
  PLANE_WORK_ITEM_FILTER_ORDER
} from '../../../src/shared/plane-work-item-filter-labels'
import type { PickerOption } from '../components/PickerModal'

// Its own module rather than a section of task-source-picker-options: that file
// reaches react-native for the provider icons, so nothing there can be tested
// without mounting it, and this list carries no JSX.
// Subtitles are mobile-only; the labels are not — they come from the table both
// clients share, so a desktop rename cannot leave the two naming the same id
// differently again (ORCA-460).
const PLANE_FILTER_SUBTITLES: Record<PlaneWorkItemFilter, string> = {
  everything: 'Any state, open or closed',
  assigned: 'Work items assigned to you',
  created: 'Work items you created',
  all: 'Open work items in scope',
  done: 'Recently completed work items'
}

export const PLANE_FILTER_OPTIONS: PickerOption<PlaneWorkItemFilter>[] =
  PLANE_WORK_ITEM_FILTER_ORDER.map((value) => ({
    value,
    label: PLANE_WORK_ITEM_FILTER_LABELS[value],
    subtitle: PLANE_FILTER_SUBTITLES[value]
  }))

const PLANE_FILTERS = new Set<PlaneWorkItemFilter>(
  PLANE_FILTER_OPTIONS.map((option) => option.value)
)

export function normalizePlaneFilter(value: unknown): PlaneWorkItemFilter {
  return PLANE_FILTERS.has(value as PlaneWorkItemFilter)
    ? (value as PlaneWorkItemFilter)
    : DEFAULT_PLANE_WORK_ITEM_FILTER
}
