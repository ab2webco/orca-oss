import type { PlaneViewMode } from '../../../shared/types'

/** Project selection sentinel meaning "every project", which the board cannot render. */
const ALL_PROJECTS = 'all'

/**
 * The view to actually render, given the saved preference and the current scope.
 *
 * Why this is not just the preference: the board needs one project's states to
 * build its columns, so it is disabled while the scope is every project. Without
 * this, a saved 'board' preference would render an empty pane on first open.
 * The preference itself is never rewritten — widening back to one project
 * restores the board the user chose.
 */
export function resolvePlaneViewMode(args: {
  preference: PlaneViewMode | undefined
  projectSelection: string
}): PlaneViewMode {
  const preference = args.preference ?? 'board'
  if (preference === 'board' && args.projectSelection === ALL_PROJECTS) {
    return 'list'
  }
  return preference
}
