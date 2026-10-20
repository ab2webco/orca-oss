// Finds the game band in a terminal viewport: the mod draws it as truecolor upper-half blocks.
export type BandCell = { code: number; isRgb: boolean }

export type BandRegion = { top: number; rows: number; left: number; cols: number }

const UPPER_HALF = 0x2580
const MIN_ROWS = 4
const MIN_COLS = 16
// Why not 1: the thought bubble and floating words put real glyphs inside the scene.
const MIN_HALF_SHARE = 0.6

type RowSpan = { left: number; right: number }

const rasterSpanOf = (cells: readonly BandCell[]): RowSpan | null => {
  let left = -1
  let right = -1
  let halves = 0
  cells.forEach((cell, x) => {
    if (cell.isRgb && cell.code === UPPER_HALF) {
      halves += 1
      left = left === -1 ? x : left
      right = x
    }
  })
  const width = right - left + 1
  return halves >= MIN_COLS && halves >= width * MIN_HALF_SHARE ? { left, right } : null
}

/** The lowest run of raster rows; older copies in scrollback sit above the live one. */
export const findBandRegion = (
  rowCount: number,
  readRow: (y: number) => readonly BandCell[] | null
): BandRegion | null => {
  let best: BandRegion | null = null
  let run: { top: number; left: number; right: number } | null = null
  const close = (endY: number): void => {
    if (run !== null && endY - run.top >= MIN_ROWS) {
      best = { top: run.top, rows: endY - run.top, left: run.left, cols: run.right - run.left + 1 }
    }
    run = null
  }
  for (let y = 0; y < rowCount; y += 1) {
    const cells = readRow(y)
    const span = cells === null ? null : rasterSpanOf(cells)
    if (span === null) {
      close(y)
      continue
    }
    run =
      run === null
        ? { top: y, left: span.left, right: span.right }
        : {
            top: run.top,
            left: Math.min(run.left, span.left),
            right: Math.max(run.right, span.right)
          }
  }
  close(rowCount)
  return best
}
