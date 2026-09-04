import type { PlaneMobileState, PlaneMobileWorkItem } from './plane-mobile-work-item-read'
import { getPlanePriorityRank } from './plane-mobile-work-item-read'

export type PlaneTaskItem = {
  key: string
  provider: 'plane'
  title: string
  subtitle: string
  status: string
  updatedAt: string
  source: PlaneMobileWorkItem
}

const UNTITLED_WORK_ITEM = 'Untitled work item'

export function createPlaneTask(item: PlaneMobileWorkItem): PlaneTaskItem {
  const scope = item.project.name || item.project.identifier
  const identifier = item.identifier || item.project.identifier
  return {
    key: `plane:${item.workspaceId ?? 'workspace'}:${item.id}`,
    provider: 'plane',
    title: item.title || UNTITLED_WORK_ITEM,
    subtitle: [identifier, scope].filter(Boolean).join(' · '),
    // Why: an unknown or missing state group must still read as something, so
    // fall back to the raw group before giving up on the label entirely.
    status: item.state.name || item.state.group || 'Unknown',
    updatedAt: item.updatedAt,
    source: item
  }
}

export function filterPlaneWorkItemsByState(
  items: readonly PlaneMobileWorkItem[],
  selectedStateIds: ReadonlySet<string>
): PlaneMobileWorkItem[] {
  if (selectedStateIds.size === 0) {
    return [...items]
  }
  return items.filter((item) => selectedStateIds.has(item.state.id))
}

export function sortPlaneWorkItems(
  items: readonly PlaneMobileWorkItem[],
  states: readonly PlaneMobileState[]
): PlaneMobileWorkItem[] {
  // Plane's own board order, when the scope is a single project that reported it.
  const orderByStateId = new Map(states.map((state, index) => [state.id, state.sequence ?? index]))
  return [...items].sort((a, b) => {
    const stateDelta =
      (orderByStateId.get(a.state.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderByStateId.get(b.state.id) ?? Number.MAX_SAFE_INTEGER)
    if (stateDelta !== 0) {
      return stateDelta
    }
    const priorityDelta = getPlanePriorityRank(a.priority) - getPlanePriorityRank(b.priority)
    return priorityDelta === 0 ? planeTime(b.updatedAt) - planeTime(a.updatedAt) : priorityDelta
  })
}

function planeTime(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

export function reconcilePlaneStateSelection(
  selected: ReadonlySet<string>,
  states: readonly PlaneMobileState[]
): Set<string> {
  const known = new Set(states.map((state) => state.id))
  return new Set([...selected].filter((id) => known.has(id)))
}
