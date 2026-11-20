import type {
  SnakeCell,
  SnakeDirection,
  SnakeState
} from '../../../../shared/orchestrator-game-arcade-snake-rules'
import type { OrchestratorGameArcadeSnake } from '../../../../shared/orchestrator-game-arcade-file'
import {
  arcadeBoardOf,
  type ArcadeBoard,
  type ArcadeBoardSize,
  type ArcadeGrid
} from './arcade-board'
import { arcadeTokens, type ArcadeTokens } from './arcade-theme-tokens'

// Draws the snake in its own grow bed: a lit tray on a dotted lab floor, the vine as one glowing
// stem through its cells, and a pulsing berry. Every colour is an app token, read at draw time.

type Size = ArcadeBoardSize

/** The lab floor around the bed: a dot matrix under two soft lamps. */
export function snakeBackdropOf(size: ArcadeBoardSize & { scale: number }): HTMLCanvasElement {
  const t = arcadeTokens()
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size.width * size.scale)
  canvas.height = Math.round(size.height * size.scale)
  const g = canvas.getContext('2d')
  if (!g) {
    return canvas
  }
  g.scale(size.scale, size.scale)
  const { width: w, height: h } = size
  g.fillStyle = t.css('background')
  g.fillRect(0, 0, w, h)
  for (const [x, y, role] of [
    [0.15, 0.2, 'success'],
    [0.85, 0.85, 'cyan']
  ] as const) {
    const lamp = g.createRadialGradient(w * x, h * y, 2, w * x, h * y, Math.max(w, h) * 0.6)
    lamp.addColorStop(0, t.css(role, t.isDark ? 0.16 : 0.1))
    lamp.addColorStop(1, t.css(role, 0))
    g.fillStyle = lamp
    g.fillRect(0, 0, w, h)
  }
  g.fillStyle = t.css('mutedForeground', t.isDark ? 0.22 : 0.28)
  for (let y = 8; y < h; y += 16) {
    for (let x = 8; x < w; x += 16) {
      g.fillRect(x, y, 1.2, 1.2)
    }
  }
  return canvas
}

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

function paintBed(
  g: CanvasRenderingContext2D,
  t: ArcadeTokens,
  board: ArcadeBoard,
  grid: ArcadeGrid
): void {
  const w = board.cell * grid.columns
  const h = board.cell * grid.rows
  g.fillStyle = t.css('muted', 0.72)
  g.strokeStyle = t.css('success', 0.65)
  g.lineWidth = 1.5
  g.shadowColor = t.css('success', 0.5)
  g.shadowBlur = 10
  g.beginPath()
  g.roundRect(board.left - 4, board.top - 4, w + 8, h + 8, 10)
  g.fill()
  g.shadowBlur = 0
  g.stroke()
  g.strokeStyle = t.css('mutedForeground', t.isDark ? 0.1 : 0.14)
  g.lineWidth = 1
  g.beginPath()
  for (let x = 1; x < grid.columns; x += 1) {
    g.moveTo(board.left + x * board.cell + 0.5, board.top)
    g.lineTo(board.left + x * board.cell + 0.5, board.top + h)
  }
  for (let y = 1; y < grid.rows; y += 1) {
    g.moveTo(board.left, board.top + y * board.cell + 0.5)
    g.lineTo(board.left + w, board.top + y * board.cell + 0.5)
  }
  g.stroke()
}

function paintBerry(
  g: CanvasRenderingContext2D,
  t: ArcadeTokens,
  board: ArcadeBoard,
  food: SnakeCell,
  time: number
): void {
  const x = board.left + (food.x + 0.5) * board.cell
  const y = board.top + (food.y + 0.5) * board.cell
  const r = board.cell * 0.32
  const wave = (time * 1.2) % 1
  g.strokeStyle = t.css('attention', 0.6 * (1 - wave))
  g.lineWidth = 1.5
  g.beginPath()
  g.arc(x, y, r + wave * board.cell * 0.6, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = t.css('attention')
  g.shadowColor = t.css('attention', 0.9)
  g.shadowBlur = board.cell * 0.6
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
  g.shadowBlur = 0
  g.fillStyle = t.css('background', 0.45)
  g.beginPath()
  g.arc(x - r * 0.3, y - r * 0.3, r * 0.28, 0, Math.PI * 2)
  g.fill()
}

const EYES: Record<SnakeDirection, [number, number][]> = {
  right: [
    [0.2, -0.2],
    [0.2, 0.2]
  ],
  left: [
    [-0.2, -0.2],
    [-0.2, 0.2]
  ],
  up: [
    [-0.2, -0.2],
    [0.2, -0.2]
  ],
  down: [
    [-0.2, 0.2],
    [0.2, 0.2]
  ]
}

function paintVine(
  g: CanvasRenderingContext2D,
  t: ArcadeTokens,
  board: ArcadeBoard,
  state: SnakeState
): void {
  const { body, heading } = state
  const { cell } = board
  const centre = (one: SnakeCell): [number, number] => [
    board.left + (one.x + 0.5) * cell,
    board.top + (one.y + 0.5) * cell
  ]
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // Why one segment at a time: the stem fades toward its tail.
  for (let i = body.length - 1; i > 0; i -= 1) {
    const from = body[i]
    const to = body[i - 1]
    if (!from || !to) {
      continue
    }
    const [x1, y1] = centre(from)
    const [x2, y2] = centre(to)
    g.strokeStyle = t.css('success', 0.4 + 0.6 * (1 - i / body.length))
    g.lineWidth = cell * 0.56
    g.beginPath()
    g.moveTo(x1, y1)
    g.lineTo(x2, y2)
    g.stroke()
    if (i % 2 === 0) {
      g.fillStyle = t.css('cyan', 0.85)
      g.beginPath()
      g.arc(x1, y1, cell * 0.11, 0, Math.PI * 2)
      g.fill()
    }
  }
  const head = body[0]
  if (!head) {
    return
  }
  const [hx, hy] = centre(head)
  g.fillStyle = t.css('success')
  g.shadowColor = t.css('success', 0.9)
  g.shadowBlur = cell * 0.7
  g.beginPath()
  g.arc(hx, hy, cell * 0.42, 0, Math.PI * 2)
  g.fill()
  g.shadowBlur = 0
  g.fillStyle = t.css('background')
  for (const [ex, ey] of EYES[heading]) {
    g.beginPath()
    g.arc(hx + ex * cell, hy + ey * cell, Math.max(1, cell * 0.08), 0, Math.PI * 2)
    g.fill()
  }
}

export function paintSnakeRun(
  g: CanvasRenderingContext2D,
  game: OrchestratorGameArcadeSnake,
  state: SnakeState,
  size: Size
): void {
  const t = arcadeTokens()
  const board = arcadeBoardOf(size, game.grid)
  paintBed(g, t, board, game.grid)
  if (state.food) {
    paintBerry(g, t, board, state.food, state.ms / 1000)
  }
  paintVine(g, t, board, state)
}
