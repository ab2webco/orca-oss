// How many agents fill the grid at once (ORCA-234).
//
// The count sizes the rows; anything past it stays reachable by scrolling. The
// owner rejected paging: flipping a page to reach one pane of another project
// is worse than a scrollbar.

/** Offered visible-count choices. Beyond 12 a cell stops showing readable output. */
export const AGENT_GRID_PAGE_SIZE_OPTIONS = [1, 2, 4, 6, 9, 12] as const
export const AGENT_GRID_DEFAULT_PAGE_SIZE = 4
