// The playing field the grid games (snake, bricks, defense) draw on: the largest whole cell that
// fits below the score lines, centred, over a veil that keeps the dusk backdrop showing through.

export type ArcadeBoardSize = { width: number; height: number }
export type ArcadeGrid = { columns: number; rows: number }
export type ArcadeBoard = { left: number; top: number; cell: number }

// Why 56: the score and hint lines sit above the field and must never cover a cell.
const TEXT_ROOM = 56
const MARGIN = 12
const CELL_MAX = 30

export const arcadeHexOf = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

export function arcadeBoardOf(size: ArcadeBoardSize, grid: ArcadeGrid): ArcadeBoard {
  const fit = Math.min(
    (size.width - MARGIN * 2) / grid.columns,
    (size.height - TEXT_ROOM - MARGIN) / grid.rows
  )
  const cell = Math.max(4, Math.min(CELL_MAX, Math.floor(fit)))
  return {
    cell,
    left: Math.round((size.width - cell * grid.columns) / 2),
    top: Math.round(TEXT_ROOM + (size.height - TEXT_ROOM - MARGIN - cell * grid.rows) / 2)
  }
}

/** The veiled field; `isChecked` adds the faint checkerboard a cell-by-cell game reads by. */
export function paintArcadeField(
  g: CanvasRenderingContext2D,
  board: ArcadeBoard,
  grid: ArcadeGrid,
  isChecked: boolean
): void {
  const w = board.cell * grid.columns
  const h = board.cell * grid.rows
  g.fillStyle = 'rgb(18 28 22 / 0.42)'
  g.beginPath()
  g.roundRect(board.left - 4, board.top - 4, w + 8, h + 8, 8)
  g.fill()
  g.strokeStyle = 'rgb(255 244 214 / 0.35)'
  g.lineWidth = 1.5
  g.stroke()
  if (!isChecked) {
    return
  }
  g.fillStyle = 'rgb(255 255 255 / 0.05)'
  for (let y = 0; y < grid.rows; y += 1) {
    for (let x = y % 2; x < grid.columns; x += 2) {
      g.fillRect(board.left + x * board.cell, board.top + y * board.cell, board.cell, board.cell)
    }
  }
}
