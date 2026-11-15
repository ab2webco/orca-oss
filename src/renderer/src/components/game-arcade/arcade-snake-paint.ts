import type {
  SnakeCell,
  SnakeDirection,
  SnakeState
} from '../../../../shared/orchestrator-game-arcade-snake-rules'
import type { OrchestratorGameArcadeSnake } from '../../../../shared/orchestrator-game-arcade-file'
import {
  arcadeBoardOf,
  arcadeHexOf,
  paintArcadeField,
  type ArcadeBoard,
  type ArcadeBoardSize
} from './arcade-board'

// Draws the snake on the runner's dusk backdrop: a veiled field on the meadow, a vine of rounded
// cells with leaves at the joints, and a glowing berry. Colours come from the game file.

type Size = ArcadeBoardSize
type SnakeBoard = ArcadeBoard

/** A tap steers toward itself from the head, along whichever axis is farther off. */
export function snakeTapTurnOf(
  game: Pick<OrchestratorGameArcadeSnake, 'grid'>,
  state: SnakeState,
  size: Size,
  x: number,
  y: number
): SnakeDirection | undefined {
  const head = state.body[0]
  if (!head) {
    return undefined
  }
  const board = arcadeBoardOf(size, game.grid)
  const dx = x - (board.left + (head.x + 0.5) * board.cell)
  const dy = y - (board.top + (head.y + 0.5) * board.cell)
  if (dx === 0 && dy === 0) {
    return undefined
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left'
  }
  return dy > 0 ? 'down' : 'up'
}

function paintBerry(
  g: CanvasRenderingContext2D,
  board: SnakeBoard,
  food: SnakeCell,
  color: number,
  t: number
) {
  const x = board.left + (food.x + 0.5) * board.cell
  const y = board.top + (food.y + 0.5) * board.cell
  const r = board.cell * (0.34 + Math.sin(t * 5) * 0.03)
  const glow = g.createRadialGradient(x, y, 1, x, y, board.cell)
  glow.addColorStop(0, 'rgb(255 190 150 / 0.5)')
  glow.addColorStop(1, 'rgb(255 190 150 / 0)')
  g.fillStyle = glow
  g.fillRect(x - board.cell, y - board.cell, board.cell * 2, board.cell * 2)
  g.fillStyle = arcadeHexOf(color)
  g.beginPath()
  g.arc(x, y + r * 0.1, r, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgb(255 255 255 / 0.55)'
  g.beginPath()
  g.arc(x - r * 0.35, y - r * 0.25, r * 0.25, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#4f7d36'
  g.beginPath()
  g.ellipse(x + r * 0.3, y - r * 0.95, r * 0.45, r * 0.2, -0.5, 0, Math.PI * 2)
  g.fill()
}

const EYES: Record<SnakeDirection, [number, number][]> = {
  right: [
    [0.68, 0.32],
    [0.68, 0.68]
  ],
  left: [
    [0.32, 0.32],
    [0.32, 0.68]
  ],
  up: [
    [0.32, 0.32],
    [0.68, 0.32]
  ],
  down: [
    [0.32, 0.68],
    [0.68, 0.68]
  ]
}

function paintVine(
  g: CanvasRenderingContext2D,
  board: SnakeBoard,
  game: OrchestratorGameArcadeSnake,
  state: SnakeState
) {
  const { body, heading } = state
  const { cell } = board
  const inset = Math.max(1, cell * 0.08)
  for (let i = body.length - 1; i >= 0; i -= 1) {
    const one = body[i]
    if (!one) {
      continue
    }
    const x = board.left + one.x * cell
    const y = board.top + one.y * cell
    g.fillStyle = arcadeHexOf(i === 0 ? game.colors.head : game.colors.body)
    g.beginPath()
    g.roundRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2, cell * 0.32)
    g.fill()
    if (i > 0 && i % 2 === 0) {
      g.fillStyle = 'rgb(255 255 255 / 0.18)'
      g.beginPath()
      g.ellipse(x + cell * 0.5, y + cell * 0.5, cell * 0.22, cell * 0.1, 0.7, 0, Math.PI * 2)
      g.fill()
    }
  }
  const head = body[0]
  if (!head) {
    return
  }
  g.fillStyle = '#1d1a22'
  for (const [ex, ey] of EYES[heading]) {
    g.beginPath()
    g.arc(
      board.left + (head.x + ex) * cell,
      board.top + (head.y + ey) * cell,
      Math.max(1, cell * 0.09),
      0,
      Math.PI * 2
    )
    g.fill()
  }
}

export function paintSnakeRun(
  g: CanvasRenderingContext2D,
  game: OrchestratorGameArcadeSnake,
  state: SnakeState,
  size: Size
): void {
  const board = arcadeBoardOf(size, game.grid)
  paintArcadeField(g, board, game.grid, true)
  if (state.food) {
    paintBerry(g, board, state.food, game.colors.food, state.ms / 1000)
  }
  paintVine(g, board, game, state)
}
