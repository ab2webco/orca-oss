import type { OrchestratorGameArcadeDefense } from '../../../../shared/orchestrator-game-arcade-file'
import {
  defenseMergeLineOf,
  type DefenseEnemy,
  type DefenseState
} from '../../../../shared/orchestrator-game-arcade-defense-rules'
import {
  arcadeBoardOf,
  arcadeHexOf,
  paintArcadeField,
  type ArcadeBoard,
  type ArcadeBoardSize
} from './arcade-board'

// Draws the base defense in its own sea: an orca turret on the merge line firing sonar bolts up at
// bugs and red builds sinking toward it. Sprites take the game file's colours.

const WATER = { fill: 'rgb(2 14 28 / 0.72)', edge: '#3fb6c9' }

/** Deep water with shafts of light from the surface. */
export function defenseBackdropOf(size: ArcadeBoardSize & { scale: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size.width * size.scale)
  canvas.height = Math.round(size.height * size.scale)
  const g = canvas.getContext('2d')
  if (!g) {
    return canvas
  }
  g.scale(size.scale, size.scale)
  const sea = g.createLinearGradient(0, 0, 0, size.height)
  sea.addColorStop(0, '#0f4a63')
  sea.addColorStop(1, '#041626')
  g.fillStyle = sea
  g.fillRect(0, 0, size.width, size.height)
  g.fillStyle = 'rgb(180 240 255 / 0.05)'
  for (let i = 0; i < 6; i += 1) {
    const x = ((i * 0.37) % 1) * size.width
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x + size.width * 0.08, 0)
    g.lineTo(x + size.width * 0.2, size.height)
    g.lineTo(x + size.width * 0.12, size.height)
    g.fill()
  }
  return canvas
}

function paintOrca(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  u: number,
  game: OrchestratorGameArcadeDefense
) {
  g.fillStyle = arcadeHexOf(game.colors.turret)
  g.beginPath()
  g.ellipse(x, y, u * 1.1, u * 0.55, 0, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.moveTo(x - u * 0.15, y - u * 0.45)
  g.lineTo(x + u * 0.1, y - u * 1.2)
  g.lineTo(x + u * 0.35, y - u * 0.4)
  g.fill()
  g.fillStyle = arcadeHexOf(game.colors.belly)
  g.beginPath()
  g.ellipse(x + u * 0.1, y + u * 0.22, u * 0.65, u * 0.22, 0, 0, Math.PI * 2)
  g.ellipse(x - u * 0.55, y - u * 0.15, u * 0.2, u * 0.12, -0.3, 0, Math.PI * 2)
  g.fill()
}

function paintEnemy(
  g: CanvasRenderingContext2D,
  board: ArcadeBoard,
  one: DefenseEnemy,
  game: OrchestratorGameArcadeDefense
) {
  const u = board.cell
  const x = board.left + one.x * u
  const y = board.top + one.y * u
  if (one.kind === 'build') {
    g.fillStyle = arcadeHexOf(game.colors.build)
    g.beginPath()
    g.roundRect(x - u * 0.45, y - u * 0.45, u * 0.9, u * 0.9, u * 0.18)
    g.fill()
    g.strokeStyle = '#fff'
    g.lineWidth = Math.max(1.5, u * 0.12)
    g.beginPath()
    g.moveTo(x - u * 0.2, y - u * 0.2)
    g.lineTo(x + u * 0.2, y + u * 0.2)
    g.moveTo(x + u * 0.2, y - u * 0.2)
    g.lineTo(x - u * 0.2, y + u * 0.2)
    g.stroke()
    if (one.hp === 1) {
      g.strokeStyle = 'rgb(0 0 0 / 0.5)'
      g.lineWidth = 1
      g.strokeRect(x - u * 0.45, y - u * 0.45, u * 0.9, u * 0.9)
    }
    return
  }
  g.strokeStyle = arcadeHexOf(game.colors.bug)
  g.lineWidth = Math.max(1, u * 0.07)
  g.beginPath()
  for (const side of [-1, 1]) {
    for (const row of [-0.2, 0.05, 0.3]) {
      g.moveTo(x, y + row * u)
      g.lineTo(x + side * u * 0.45, y + (row + 0.1) * u)
    }
  }
  g.stroke()
  g.fillStyle = arcadeHexOf(game.colors.bug)
  g.beginPath()
  g.ellipse(x, y + u * 0.05, u * 0.28, u * 0.38, 0, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.arc(x, y - u * 0.4, u * 0.16, 0, Math.PI * 2)
  g.fill()
}

export function paintDefenseRun(
  g: CanvasRenderingContext2D,
  game: OrchestratorGameArcadeDefense,
  state: DefenseState,
  size: ArcadeBoardSize
): void {
  const board = arcadeBoardOf(size, game.field)
  const u = board.cell
  paintArcadeField(g, board, game.field, WATER)
  const line = board.top + defenseMergeLineOf(game) * u
  g.strokeStyle = 'rgb(120 230 160 / 0.8)'
  g.lineWidth = 2
  g.setLineDash([u * 0.6, u * 0.4])
  g.beginPath()
  g.moveTo(board.left, line)
  g.lineTo(board.left + game.field.columns * u, line)
  g.stroke()
  g.setLineDash([])
  for (const one of state.enemies) {
    paintEnemy(g, board, one, game)
  }
  g.fillStyle = arcadeHexOf(game.colors.shot)
  for (const shot of state.shots) {
    g.beginPath()
    g.ellipse(
      board.left + shot.x * u,
      board.top + shot.y * u,
      u * 0.12,
      u * 0.35,
      0,
      0,
      Math.PI * 2
    )
    g.fill()
  }
  paintOrca(g, board.left + state.turret * u, line + u * 0.9, u, game)
  // Why below the line: the top row is where enemies fall in, and one would cover the lives.
  g.fillStyle = 'rgb(255 255 255 / 0.85)'
  for (let i = 0; i < state.lives; i += 1) {
    g.beginPath()
    g.arc(
      board.left + game.field.columns * u - (i + 0.6) * u * 0.8,
      line + u * 1.1,
      u * 0.22,
      0,
      Math.PI * 2
    )
    g.fill()
  }
}

/** The field column under a pointer, for the turret to follow. */
export function defenseColumnAtOf(
  game: Pick<OrchestratorGameArcadeDefense, 'field'>,
  size: ArcadeBoardSize,
  x: number
): number {
  const board = arcadeBoardOf(size, game.field)
  return (x - board.left) / board.cell
}
