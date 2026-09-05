import {
  PLANE_WORK_ITEM_PRIORITIES,
  type PlaneWorkItemPriority
} from '../../../src/shared/plane-types'
import { getPlanePriorityRank } from './plane-mobile-work-item-read'

export const PLANE_PRIORITY_LABELS: Record<PlaneWorkItemPriority, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent'
}

/** Highest first, the order a picker reads them in. */
export const PLANE_PRIORITY_PICKER_ORDER: readonly PlaneWorkItemPriority[] = [
  ...PLANE_WORK_ITEM_PRIORITIES
].sort((left, right) => getPlanePriorityRank(left) - getPlanePriorityRank(right))
