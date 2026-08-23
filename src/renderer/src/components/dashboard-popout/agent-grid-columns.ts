// Column geometry for the consolidated agent grid (ORCA-234).
//
// Resolved in JS from the measured container rather than left to CSS
// `auto-fill`: the count is the thing the layout is judged on, and a computed
// number is assertable where a CSS track list is not. It also removes the
// failure the owner reported — `minmax(228px, 1fr)` collapses to ONE full-width
// track below a ~470px container, which is every pop-out near its 480px floor.

/** A tail is unreadable much below this: ~46 monospace columns at 11px. */
export const AGENT_GRID_MIN_CELL_WIDTH = 320
export const AGENT_GRID_CELL_GAP = 8
/** Uniform by design: a row of equal boxes reads as a grid, a ragged one does
 *  not. Sized for the header rows plus AGENT_GRID_TAIL_LINES of terminal. */
export const AGENT_GRID_CELL_HEIGHT = 216
export const AGENT_GRID_TAIL_LINES = 8
/** Past this, cells stop being scannable and start being a spreadsheet. */
export const AGENT_GRID_MAX_COLUMNS = 8
/** Used for the frame before the observer reports: the pop-out's own default
 *  960px width less its 24px of padding. Better than a one-column flash. */
export const AGENT_GRID_FALLBACK_WIDTH = 936

/**
 * How many uniform cells fit across `containerWidth`.
 *
 * Never returns 0: one column that overflows its floor still beats rendering
 * nothing, and the cell clips its own content.
 */
export function resolveAgentGridColumns(containerWidth: number, cellCount?: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return 1
  }
  const fit = Math.floor(
    (containerWidth + AGENT_GRID_CELL_GAP) / (AGENT_GRID_MIN_CELL_WIDTH + AGENT_GRID_CELL_GAP)
  )
  // Why cap by count: tracks the cards cannot fill leave one agent in a narrow
  // column of a wide pop-out, which is the state the tail is least readable in.
  const wanted =
    typeof cellCount === 'number' && Number.isFinite(cellCount) ? Math.min(fit, cellCount) : fit
  return Math.min(AGENT_GRID_MAX_COLUMNS, Math.max(1, wanted))
}

/** Rows needed for `cellCount` cards at `columns` across. */
export function resolveAgentGridRows(cellCount: number, columns: number): number {
  if (!Number.isFinite(cellCount) || cellCount <= 0 || !Number.isFinite(columns) || columns <= 0) {
    return 1
  }
  return Math.ceil(cellCount / columns)
}

/** Header rows above the tail inside a cell, plus its padding. */
const AGENT_GRID_CELL_CHROME_HEIGHT = 76
/** Line box of the 11px monospace tail. */
const AGENT_GRID_TAIL_LINE_HEIGHT = 16

/**
 * Tail lines a cell of `cellHeight` can show without clipping.
 *
 * Why derived and not constant: a cell that fills the pop-out is several times
 * taller than the fixed box it replaced, and asking for 8 lines there wastes
 * the space the owner asked to use.
 */
export function resolveAgentGridTailLines(cellHeight: number, maxLines: number): number {
  if (!Number.isFinite(cellHeight) || cellHeight <= 0) {
    return AGENT_GRID_TAIL_LINES
  }
  const fits = Math.floor((cellHeight - AGENT_GRID_CELL_CHROME_HEIGHT) / AGENT_GRID_TAIL_LINE_HEIGHT)
  return Math.min(maxLines, Math.max(4, fits))
}

/**
 * Floor for a cell's height, by how many share the grid.
 *
 * Why a floor and not only `1fr`: `1fr` distributes free space, and a host that
 * gives the grid no definite height has none to distribute — the cells then
 * collapse to their content, which is the unreadable state the owner reported.
 */
export function resolveAgentGridMinCellHeight(cellCount: number): number {
  if (!Number.isFinite(cellCount) || cellCount <= 2) {
    return 420
  }
  if (cellCount <= 4) {
    return 320
  }
  if (cellCount <= 6) {
    return 260
  }
  return 200
}
