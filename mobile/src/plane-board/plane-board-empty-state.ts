import type { PlaneBoardColumn } from './plane-board-columns'

/** One entry per cause. The UX inventory's central finding is that one text for
 *  several causes is the most expensive defect in this app, so a board never
 *  answers "no items" — it says which of these five happened and what to do. */
export type PlaneBoardEmptyStateKind =
  | 'disconnected'
  | 'no-project'
  | 'board-empty'
  | 'filter-empty'
  | 'column-empty'

export type PlaneBoardEmptyState = {
  kind: PlaneBoardEmptyStateKind
  title: string
  body: string
  /** Null when the cause has no in-app remedy, so the surface shows no dead button. */
  action: 'pick-project' | 'clear-filter' | 'refresh' | null
  actionLabel: string | null
}

export type PlaneBoardEmptyStateInput = {
  planeConnected: boolean
  projectId: string | null
  projectName: string | null
  columns: readonly PlaneBoardColumn[]
  activeColumn: PlaneBoardColumn | null
  /** True when a search or state filter is narrowing the board. */
  filtered: boolean
  /** Cards the host returned before this client filtered them. */
  unfilteredCount: number
}

export function resolvePlaneBoardEmptyState(
  input: PlaneBoardEmptyStateInput
): PlaneBoardEmptyState | null {
  if (!input.planeConnected) {
    return {
      kind: 'disconnected',
      title: 'Plane is not connected on this host',
      body: 'Connect Plane in the Orca Lab desktop app on this host, then pull to refresh.',
      action: 'refresh',
      actionLabel: 'Check again'
    }
  }
  if (!input.projectId) {
    return {
      kind: 'no-project',
      title: 'Pick a project',
      body: 'A board shows one Plane project at a time. Choose which one to open.',
      action: 'pick-project',
      actionLabel: 'Choose project'
    }
  }
  if (input.columns.length === 0) {
    return {
      kind: 'board-empty',
      title: `${input.projectName ?? 'This project'} has no columns yet`,
      body: 'Add states to the project in Plane and they will show up here as columns.',
      action: 'refresh',
      actionLabel: 'Refresh'
    }
  }
  if (input.filtered && input.unfilteredCount > 0) {
    return {
      kind: 'filter-empty',
      title: 'No cards match the filter',
      body:
        input.unfilteredCount === 1
          ? '1 card in this project is hidden by the current search or state filter.'
          : `${input.unfilteredCount} cards in this project are hidden by the current search or state filter.`,
      action: 'clear-filter',
      actionLabel: 'Clear filter'
    }
  }
  if (input.unfilteredCount === 0) {
    return {
      kind: 'board-empty',
      title: `${input.projectName ?? 'This project'} has no work items`,
      body: 'Cards created in Plane show up here. Creating them from the phone is not available yet.',
      action: 'refresh',
      actionLabel: 'Refresh'
    }
  }
  if (input.activeColumn && input.activeColumn.items.length === 0) {
    return {
      kind: 'column-empty',
      title: `Nothing in ${input.activeColumn.name}`,
      body: 'Other columns in this project have cards. Move one here from its detail.',
      action: null,
      actionLabel: null
    }
  }
  return null
}
