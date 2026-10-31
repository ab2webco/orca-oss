import {
  statusGroupOfName,
  statusGroupOfPlane,
  type GameWorkItem
} from '../../shared/orchestrator-game-state'

export type TrackerItem = { identifier: string; title: string; url: string; stateName: string }

/** The worktree's current Plane item, else its Linear one; null leaves its linked item to decide. */
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
  return linear
    ? {
        provider: 'linear',
        identifier: linear.identifier,
        title: linear.title,
        url: linear.url,
        status: linear.stateName,
        statusGroup: statusGroupOfName(linear.stateName)
      }
    : null
}
