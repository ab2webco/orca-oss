// Paging for the consolidated agent grid (ORCA-234).
//
// Why paging and not scrolling: cells fill the pop-out, so a fifth agent has no
// room to appear below — it needs a page, not a scrollbar.

/** Offered visible-count choices. Beyond 12 a cell stops showing readable output. */
export const AGENT_GRID_PAGE_SIZE_OPTIONS = [1, 2, 4, 6, 9, 12] as const
export const AGENT_GRID_DEFAULT_PAGE_SIZE = 4

export type AgentGridPage<T> = {
  visible: T[]
  pageIndex: number
  pageCount: number
}

/**
 * Slices `cells` to one page, clamping an out-of-range index rather than
 * rendering an empty grid when agents disappear while a later page is open.
 */
export function resolveAgentGridPage<T>(
  cells: readonly T[],
  pageSize: number,
  pageIndex: number
): AgentGridPage<T> {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : cells.length || 1
  const pageCount = Math.max(1, Math.ceil(cells.length / size))
  const index = Number.isFinite(pageIndex) ? Math.min(Math.max(0, Math.floor(pageIndex)), pageCount - 1) : 0
  return { visible: cells.slice(index * size, index * size + size), pageIndex: index, pageCount }
}
