// The playing field the grid games (snake, bricks, defense) draw on: the largest whole cell that
// fits below the score lines, centred.

export type ArcadeBoardSize = { width: number; height: number }
export type ArcadeGrid = { columns: number; rows: number }
export type ArcadeBoard = { left: number; top: number; cell: number }

// Why 56: the score and hint lines sit above the field and must never cover a cell.
const TEXT_ROOM = 56
const MARGIN = 12
const CELL_MAX = 30

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

/** Whether the room under the score lines is taller than wide, so a game lays itself out tall. */
export const arcadeIsTallOf = (size: ArcadeBoardSize): boolean =>
  size.height - TEXT_ROOM > size.width

/** The grid as the file has it, or turned a quarter so a tall tab plays it tall and not as dots. */
export function arcadeGridFitOf(size: ArcadeBoardSize, grid: ArcadeGrid): ArcadeGrid {
  return arcadeIsTallOf(size) === grid.columns > grid.rows
    ? { columns: grid.rows, rows: grid.columns }
    : grid
}
