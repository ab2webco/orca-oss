// Client-side work-item filtering for the board/list preset filters. Plane's
// self-hosted REST API v1 ignores the ?pql= query param filterToPql builds, so
// the preset filters (Asignado / Created / Todo abierto / Hecho) must be
// applied here on the already-fetched items rather than trusting the server.
import type { PlaneWorkItem, PlaneWorkItemFilter } from '../../shared/plane-types'

// Plane state groups: backlog | unstarted | started | completed | cancelled.
const OPEN_STATE_GROUPS: ReadonlySet<string> = new Set(['backlog', 'unstarted', 'started'])
const CLOSED_STATE_GROUPS: ReadonlySet<string> = new Set(['completed', 'cancelled'])

function openItems(items: PlaneWorkItem[]): PlaneWorkItem[] {
  return items.filter((item) => OPEN_STATE_GROUPS.has(item.state.group))
}

// Pure predicate over already-fetched items. `viewerId` is the current user's
// id for the client that produced these items; null when it could not be
// resolved. For `assigned`/`created` a null viewer degrades to the open set
// (never an empty list) -- the only acceptable degradation.
export function filterPlaneWorkItems(
  items: PlaneWorkItem[],
  filter: PlaneWorkItemFilter,
  viewerId: string | null
): PlaneWorkItem[] {
  if (filter === 'everything') {
    // "Todos": every item in scope, regardless of state or assignee/creator.
    return items
  }
  if (filter === 'done') {
    return items.filter((item) => CLOSED_STATE_GROUPS.has(item.state.group))
  }
  if (filter === 'assigned') {
    if (!viewerId) {
      return openItems(items)
    }
    return items.filter((item) => item.assignees?.some((assignee) => assignee.id === viewerId))
  }
  if (filter === 'created') {
    if (!viewerId) {
      return openItems(items)
    }
    return items.filter((item) => item.createdBy === viewerId)
  }
  // 'all' -> "Todo abierto": open items only.
  return openItems(items)
}

// Only the viewer-scoped filters need the current user's id resolved.
export function filterNeedsViewer(filter: PlaneWorkItemFilter): boolean {
  return filter === 'assigned' || filter === 'created'
}
