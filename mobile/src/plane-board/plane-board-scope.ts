import type { PlaneWorkItemFilter } from '../../../src/shared/plane-types'
import type { PlaneMobileProject, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { PlaneBoardColumn } from './plane-board-columns'
import type { PlaneViewMode } from './plane-work-item-view'

/** What the board reads. The Tasks screen owns every value; the board never picks
 *  a project or a filter on its own, so both views show the same cards. */
export type PlaneBoardScope = {
  /** Nothing is read while false: Plane is not the provider, or the host cannot serve it. */
  enabled: boolean
  planeConnected: boolean
  workspaceId: string | null
  projectId: string | null
  projectName: string | null
  filter: PlaneWorkItemFilter
  query: string
}

export type PlaneBoardScopeInput = Omit<PlaneBoardScope, 'projectName'> & {
  viewMode: PlaneViewMode
  projects: readonly PlaneMobileProject[]
  /** The card whose detail is open, if any. */
  detailItem: PlaneMobileWorkItem | null
}

/** In board mode the board reads the project the Tasks screen picked. In list mode
 *  the rows come from the list itself, so the board reads only the open card's
 *  project — what its detail needs for live edits and "Move to" — and nothing
 *  while no card is open. */
export function resolvePlaneBoardScope(input: PlaneBoardScopeInput): PlaneBoardScope {
  const projectId =
    input.viewMode === 'board' ? input.projectId : (input.detailItem?.project.id ?? null)
  const project = input.projects.find((entry) => entry.id === projectId)
  const detailProject =
    input.detailItem && input.detailItem.project.id === projectId ? input.detailItem.project : null
  const named = project ?? detailProject
  return {
    enabled: input.enabled,
    planeConnected: input.planeConnected,
    workspaceId: input.workspaceId,
    projectId,
    projectName: named ? named.name || named.identifier || null : null,
    filter: input.filter,
    query: input.query
  }
}

/** 'all' is the list's unfiltered default; anything else narrows what the host returns. */
export function isPlaneBoardFiltered(scope: Pick<PlaneBoardScope, 'filter' | 'query'>): boolean {
  return scope.filter !== 'all' || scope.query.trim() !== ''
}

/** The card as the board shows it, optimistic edits included; the tapped row's own
 *  copy until the board has read that project. */
export function resolveLivePlaneWorkItem(
  columns: readonly PlaneBoardColumn[],
  item: PlaneMobileWorkItem | null
): PlaneMobileWorkItem | null {
  if (!item) {
    return null
  }
  for (const column of columns) {
    const live = column.items.find((entry) => entry.id === item.id)
    if (live) {
      return live
    }
  }
  return item
}
