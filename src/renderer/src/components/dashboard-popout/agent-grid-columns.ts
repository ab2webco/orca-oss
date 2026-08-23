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
export function resolveAgentGridColumns(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return 1
  }
  const fit = Math.floor(
    (containerWidth + AGENT_GRID_CELL_GAP) / (AGENT_GRID_MIN_CELL_WIDTH + AGENT_GRID_CELL_GAP)
  )
  return Math.min(AGENT_GRID_MAX_COLUMNS, Math.max(1, fit))
}
