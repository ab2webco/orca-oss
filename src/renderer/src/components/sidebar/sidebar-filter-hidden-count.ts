import type { Worktree } from '../../../../shared/worktree/types'
import { SIDEBAR_HIDING_FILTERS, type SidebarHidingFilter } from './sidebar-hiding-filters'

export type HiddenByFiltersBreakdown = {
  total: number
  /** Only filters that hide at least one row, in SIDEBAR_HIDING_FILTERS order. */
  counts: readonly { filter: SidebarHidingFilter; count: number }[]
  /** In sorted order, so revealing them keeps each row in its usual place. */
  hiddenIds: readonly string[]
}

export const EMPTY_HIDDEN_BY_FILTERS: HiddenByFiltersBreakdown = {
  total: 0,
  counts: [],
  hiddenIds: []
}

// Second pass over the sorted worktrees the filters left out, attributing each to the one filter
// that hid it. Archived worktrees and ids the store no longer has stay out: no filter decides on them.
export function breakDownWorktreesHiddenByFilters(
  sortedIds: readonly string[],
  visibleIds: readonly string[],
  worktreeById: ReadonlyMap<string, Worktree>,
  hidingFilterOf: (worktree: Worktree) => SidebarHidingFilter | null
): HiddenByFiltersBreakdown {
  const visible = new Set(visibleIds)
  const countByFilter = new Map<SidebarHidingFilter, number>()
  const hiddenIds: string[] = []
  for (const id of sortedIds) {
    const worktree = worktreeById.get(id)
    if (visible.has(id) || !worktree || worktree.isArchived) {
      continue
    }
    const filter = hidingFilterOf(worktree)
    if (filter === null) {
      continue
    }
    countByFilter.set(filter, (countByFilter.get(filter) ?? 0) + 1)
    hiddenIds.push(id)
  }
  if (hiddenIds.length === 0) {
    return EMPTY_HIDDEN_BY_FILTERS
  }
  const counts = SIDEBAR_HIDING_FILTERS.flatMap((filter) => {
    const count = countByFilter.get(filter)
    return count ? [{ filter, count }] : []
  })
  return { total: hiddenIds.length, counts, hiddenIds }
}
