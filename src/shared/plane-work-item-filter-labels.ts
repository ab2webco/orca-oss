import type { PlaneWorkItemFilter } from './plane-types'

/**
 * The one name each Plane filter goes by, in both clients.
 *
 * It lived twice before, and the two copies disagreed on the two ids that
 * matter: `everything` read "All" on desktop and "Everything" on mobile, while
 * `all` read "All Open" on desktop and "All" on mobile — so mobile's "All" hid
 * every done item and users read that as lost cards (ORCA-460).
 *
 * Desktop reaches these through `translate()` fallbacks rather than importing
 * them: the renderer's brand-drift parser only reads string literals, so a
 * shared constant in that argument would drop those calls out of the baseline
 * count. A renderer test pins the literals to this table instead.
 */
export const PLANE_WORK_ITEM_FILTER_LABELS: Record<PlaneWorkItemFilter, string> = {
  everything: 'All',
  assigned: 'Assigned',
  created: 'Created',
  all: 'All Open',
  done: 'Done'
}

/** The order both clients list the filters in. */
export const PLANE_WORK_ITEM_FILTER_ORDER = Object.keys(
  PLANE_WORK_ITEM_FILTER_LABELS
) as PlaneWorkItemFilter[]

/** What a client opens on, and therefore what "unfiltered" means. */
export const DEFAULT_PLANE_WORK_ITEM_FILTER: PlaneWorkItemFilter = 'everything'
