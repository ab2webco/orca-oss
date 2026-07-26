import { getPlaneProjectIdForFetch } from './task-page-plane-scope'

/**
 * Whether a Plane change announced by main affects what is currently on screen.
 *
 * Why this is not a plain `===`: the project selection uses `'all'` as a
 * sentinel, not an id, so comparing it to a real projectId never matched and
 * every refresh was dropped while viewing every project — the board kept showing
 * stale cards even though the change had been announced.
 */
export function shouldRefetchPlaneForChange(args: {
  /** Project the change targeted; null when the mutation is workspace-wide. */
  changedProjectId: string | null
  workspaceSelection: string | 'all' | null | undefined
  projectSelection: string
}): boolean {
  // A workspace-wide change gives no project to compare, so always refetch.
  if (!args.changedProjectId) {
    return true
  }
  const viewedProjectId = getPlaneProjectIdForFetch(args.workspaceSelection, args.projectSelection)
  // No resolved project means the view is not scoped to one ('all'), so any
  // project's change belongs on screen.
  if (!viewedProjectId) {
    return true
  }
  return viewedProjectId === args.changedProjectId
}
