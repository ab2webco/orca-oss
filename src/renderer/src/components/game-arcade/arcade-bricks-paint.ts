import type { OrchestratorGameArcadeBricks } from '../../../../shared/orchestrator-game-arcade-file'
import {
  BRICKS_BALL_RADIUS,
  BRICKS_PADDLE_HEIGHT,
  BRICKS_WALL_TOP,
  bricksBrickWidthOf,
  bricksPaddleTopOf,
  bricksPaddleWidthOf,
  type BricksState
} from '../../../../shared/orchestrator-game-arcade-bricks-rules'
import { arcadeBoardOf, type ArcadeBoard, type ArcadeBoardSize } from './arcade-board'
import { arcadeTokens, type ArcadeTokenRole, type ArcadeTokens } from './arcade-theme-tokens'

// Draws the brick breaker on a glass court at dusk: a low sun arc behind scan lines, the wall as lit
// tiles row by row, a light-bar paddle, a ball with a trail and falling power-ups marked with what
// they give. Every colour is an app token, read at draw time.

const DROP_MARK = { multi: '+', wide: '↔' } as const
/** The wall's rows, top down; a wall taller than this starts over. */
const ROW_ROLES: readonly ArcadeTokenRole[] = ['attention', 'warning', 'success', 'info', 'violet']

/** Dusk behind the court: the sky warming toward a sun arc low on the horizon. */
export function bricksBackdropOf(size: ArcadeBoardSize & { scale: number }): HTMLCanvasElement {
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
  const dusk = g.createLinearGradient(0, h * 0.35, 0, h)
  dusk.addColorStop(0, t.css('violet', 0))
  dusk.addColorStop(0.7, t.css('violet', t.isDark ? 0.22 : 0.12))
  dusk.addColorStop(1, t.css('warning', t.isDark ? 0.28 : 0.16))
  g.fillStyle = dusk
  g.fillRect(0, 0, w, h)
  const r = Math.max(w, h) * 0.42
  g.lineWidth = 1.5
  for (let i = 0; i < 4; i += 1) {
    g.strokeStyle = t.css('warning', (t.isDark ? 0.4 : 0.32) - i * 0.08)
    g.beginPath()
    g.arc(w / 2, h + r * 0.35, r + i * 18, Math.PI, Math.PI * 2)
    g.stroke()
  }
  g.fillStyle = t.css('foreground', t.isDark ? 0.03 : 0.025)
  for (let y = 0; y < h; y += 4) {
    g.fillRect(0, y, w, 1)
  }
  return canvas
}

/** The court: dark glass with corner marks. */
function paintCourt(
  g: CanvasRenderingContext2D,
  t: ArcadeTokens,
  board: ArcadeBoard,
  game: OrchestratorGameArcadeBricks
): void {
  const w = board.cell * game.field.columns
  const h = board.cell * game.field.rows
  const [x, y] = [board.left - 4, board.top - 4]
  g.fillStyle = t.css('background', 0.72)
  g.strokeStyle = t.css('violet', 0.55)
  g.lineWidth = 1.5
  g.beginPath()
  g.roundRect(x, y, w + 8, h + 8, 10)
  g.fill()
  g.stroke()
  const arm = Math.min(18, board.cell * 1.4)
  g.strokeStyle = t.css('foreground', 0.7)
  g.lineWidth = 2
  g.beginPath()
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w + 8, y, -1, 1],
    [x, y + h + 8, 1, -1],
    [x + w + 8, y + h + 8, -1, -1]
  ] as const) {
    g.moveTo(cx + dx * arm, cy)
    g.lineTo(cx, cy)
    g.lineTo(cx, cy + dy * arm)
  }
  g.stroke()
}

export function paintBricksRun(
  g: CanvasRenderingContext2D,
  game: OrchestratorGameArcadeBricks,
  state: BricksState,
  size: ArcadeBoardSize
): void {
  const t = arcadeTokens()
  const board = arcadeBoardOf(size, game.field)
  const u = board.cell
  const xOf = (x: number): number => board.left + x * u
  const yOf = (y: number): number => board.top + y * u
  paintCourt(g, t, board, game)
  const width = bricksBrickWidthOf(game)
  const gap = Math.max(1.5, u * 0.16)
  g.lineWidth = 1
  state.bricks.forEach((alive, i) => {
    if (!alive) {
      return
    }
    const row = Math.floor(i / game.wall.columns)
    const column = i % game.wall.columns
    const role = ROW_ROLES[row % ROW_ROLES.length] ?? 'info'
    const x = xOf(column * width) + gap / 2
    const y = yOf(BRICKS_WALL_TOP + row) + gap / 2
    g.fillStyle = t.css(role, 0.78)
    g.strokeStyle = t.css(role)
    g.beginPath()
    g.roundRect(x, y, width * u - gap, u - gap, Math.min(4, u * 0.22))
    g.fill()
    g.stroke()
    g.fillStyle = t.css(role)
    g.fillRect(x + 2, y + 1.5, width * u - gap - 4, Math.max(1, u * 0.12))
  })
  g.font = `600 ${Math.max(9, Math.round(u * 0.8))}px Geist, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const drop of state.drops) {
    const half = u * 0.48
    g.fillStyle = t.css('background', 0.85)
    g.strokeStyle = t.css('warning')
    g.lineWidth = 1.5
    g.beginPath()
    g.roundRect(xOf(drop.x) - half, yOf(drop.y) - half, half * 2, half * 2, half * 0.5)
    g.fill()
    g.stroke()
    g.fillStyle = t.css('warning')
    g.fillText(DROP_MARK[drop.kind], xOf(drop.x), yOf(drop.y) + 1)
  }
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  const paddle = bricksPaddleWidthOf(game, state)
  const top = yOf(bricksPaddleTopOf(game))
  g.fillStyle = t.css('foreground')
  g.shadowColor = t.css('info', 0.9)
  g.shadowBlur = u * 0.8
  g.beginPath()
  g.roundRect(
    xOf(state.paddle - paddle / 2),
    top,
    paddle * u,
    BRICKS_PADDLE_HEIGHT * u,
    (BRICKS_PADDLE_HEIGHT * u) / 2
  )
  g.fill()
  g.shadowBlur = 0
  g.fillStyle = t.css('info')
  g.fillRect(
    xOf(state.paddle - paddle / 2) + u * 0.4,
    top + BRICKS_PADDLE_HEIGHT * u * 0.4,
    paddle * u - u * 0.8,
    Math.max(1, u * 0.12)
  )
  for (const ball of state.balls) {
    const speed = Math.hypot(ball.vx, ball.vy) || 1
    for (let k = 3; k >= 1; k -= 1) {
      g.fillStyle = t.css('info', 0.12 * (4 - k))
      g.beginPath()
      g.arc(
        xOf(ball.x - (ball.vx / speed) * k * 0.45),
        yOf(ball.y - (ball.vy / speed) * k * 0.45),
        BRICKS_BALL_RADIUS * u * (1 - k * 0.15),
        0,
        Math.PI * 2
      )
      g.fill()
    }
    g.fillStyle = t.css('foreground')
    g.shadowColor = t.css('info')
    g.shadowBlur = u * 0.9
    g.beginPath()
    g.arc(xOf(ball.x), yOf(ball.y), BRICKS_BALL_RADIUS * u, 0, Math.PI * 2)
    g.fill()
    g.shadowBlur = 0
  }
}

/** The field column under a pointer, for the paddle to follow. */
export function bricksColumnAtOf(
  game: Pick<OrchestratorGameArcadeBricks, 'field'>,
  size: ArcadeBoardSize,
  x: number
): number {
  const board = arcadeBoardOf(size, game.field)
  return (x - board.left) / board.cell
}
