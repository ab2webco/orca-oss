import {
  statusGroupOfName,
  statusGroupOfPlane,
  type GameWorkItem
} from '../../shared/orchestrator-game-state'

export type TrackerItem = { identifier: string; title: string; url: string; stateName: string }

/** The worktree's ticket from its Plane read, else its Linear one; null when neither found it. */
export function trackerWorkItemOf(
  plane: (TrackerItem & { stateGroup: string }) | null,
  linear: TrackerItem | null
): GameWorkItem | null {
  if (plane) {
    return {
      provider: 'plane',
      identifier: plane.identifier,
      title: plane.title,
      url: plane.url,
      status: plane.stateName,
      statusGroup: statusGroupOfPlane(plane.stateGroup, plane.stateName)
    }
  }
  if (linear) {
    return {
      provider: 'linear',
      identifier: linear.identifier,
      title: linear.title,
      url: linear.url,
      status: linear.stateName,
      statusGroup: statusGroupOfName(linear.stateName)
    }
  }
  return null
}
