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
import { arcadeBoardOf, arcadeHexOf, paintArcadeField, type ArcadeBoardSize } from './arcade-board'

// Draws the brick breaker on its own night court: a dark field framed in gold over a faint mortar
// pattern, the wall in the game file's colours, row by row, the paddle, glowing balls, and falling
// power-ups marked with what they give.

const DROP_MARK = { multi: '+', wide: '↔' } as const
const COURT = { fill: 'rgb(8 10 22 / 0.82)', edge: '#f2c14e' }

/** Indigo night behind the court, with the mortar lines of an old brick wall. */
export function bricksBackdropOf(size: ArcadeBoardSize & { scale: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size.width * size.scale)
  canvas.height = Math.round(size.height * size.scale)
  const g = canvas.getContext('2d')
  if (!g) {
    return canvas
  }
  g.scale(size.scale, size.scale)
  const night = g.createLinearGradient(0, 0, 0, size.height)
  night.addColorStop(0, '#1c2140')
  night.addColorStop(1, '#2b2140')
  g.fillStyle = night
  g.fillRect(0, 0, size.width, size.height)
  g.strokeStyle = 'rgb(255 255 255 / 0.05)'
  g.lineWidth = 1
  const course = 18
  for (let row = 0, y = 0; y < size.height; row += 1, y += course) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(size.width, y)
    const shift = row % 2 === 0 ? 0 : 20
    for (let x = shift; x < size.width; x += 40) {
      g.moveTo(x, y)
      g.lineTo(x, y + course)
    }
    g.stroke()
  }
  return canvas
}

export function paintBricksRun(
  g: CanvasRenderingContext2D,
  game: OrchestratorGameArcadeBricks,
  state: BricksState,
  size: ArcadeBoardSize
): void {
  const board = arcadeBoardOf(size, game.field)
  const u = board.cell
  const xOf = (x: number): number => board.left + x * u
  const yOf = (y: number): number => board.top + y * u
  paintArcadeField(g, board, game.field, COURT)
  const width = bricksBrickWidthOf(game)
  const gap = Math.max(1, u * 0.12)
  state.bricks.forEach((alive, i) => {
    if (!alive) {
      return
    }
    const row = Math.floor(i / game.wall.columns)
    const column = i % game.wall.columns
    g.fillStyle = arcadeHexOf(game.colors.bricks[row % game.colors.bricks.length] ?? 0xffffff)
    g.beginPath()
    g.roundRect(
      xOf(column * width) + gap / 2,
      yOf(BRICKS_WALL_TOP + row) + gap / 2,
      width * u - gap,
      u - gap,
      Math.min(4, u * 0.2)
    )
    g.fill()
  })
  g.font = `600 ${Math.max(9, Math.round(u * 0.8))}px Geist, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const drop of state.drops) {
    g.fillStyle = 'rgb(255 244 214 / 0.9)'
    g.beginPath()
    g.arc(xOf(drop.x), yOf(drop.y), u * 0.45, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#1d1a22'
    g.fillText(DROP_MARK[drop.kind], xOf(drop.x), yOf(drop.y) + 1)
  }
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  const paddle = bricksPaddleWidthOf(game, state)
  g.fillStyle = arcadeHexOf(game.colors.paddle)
  g.beginPath()
  g.roundRect(
    xOf(state.paddle - paddle / 2),
    yOf(bricksPaddleTopOf(game)),
    paddle * u,
    BRICKS_PADDLE_HEIGHT * u,
    (BRICKS_PADDLE_HEIGHT * u) / 2
  )
  g.fill()
  for (const ball of state.balls) {
    const x = xOf(ball.x)
    const y = yOf(ball.y)
    const glow = g.createRadialGradient(x, y, 1, x, y, u)
    glow.addColorStop(0, 'rgb(255 244 214 / 0.45)')
    glow.addColorStop(1, 'rgb(255 244 214 / 0)')
    g.fillStyle = glow
    g.fillRect(x - u, y - u, u * 2, u * 2)
    g.fillStyle = arcadeHexOf(game.colors.ball)
    g.beginPath()
    g.arc(x, y, BRICKS_BALL_RADIUS * u, 0, Math.PI * 2)
    g.fill()
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
