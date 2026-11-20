import type { OrchestratorGameArcadeDefense } from '../../../../shared/orchestrator-game-arcade-file'
import {
  defenseMergeLineOf,
  type DefenseEnemy,
  type DefenseState
} from '../../../../shared/orchestrator-game-arcade-defense-rules'
import { arcadeBoardOf, type ArcadeBoard, type ArcadeBoardSize } from './arcade-board'
import { arcadeTokens, type ArcadeTokens } from './arcade-theme-tokens'

// Draws the base defense in its own deep: an orca on the merge line sending sonar pings up at bugs
// and failed builds sinking toward it, over sonar rings. Every colour is an app token, read at draw
// time.

/** Deep water lit from below, with the rings of a sonar sweep. */
export function defenseBackdropOf(size: ArcadeBoardSize & { scale: number }): HTMLCanvasElement {
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
  const deep = g.createLinearGradient(0, 0, 0, h)
  deep.addColorStop(0, t.css('background'))
  deep.addColorStop(1, t.css('muted'))
  g.fillStyle = deep
  g.fillRect(0, 0, w, h)
  const water = g.createLinearGradient(0, 0, 0, h)
  water.addColorStop(0, t.css('info', t.isDark ? 0.04 : 0.03))
  water.addColorStop(1, t.css('info', t.isDark ? 0.16 : 0.1))
  g.fillStyle = water
  g.fillRect(0, 0, w, h)
  const glow = g.createRadialGradient(w / 2, h, 4, w / 2, h, Math.max(w, h) * 0.8)
  glow.addColorStop(0, t.css('info', t.isDark ? 0.26 : 0.14))
  glow.addColorStop(1, t.css('info', 0))
  g.fillStyle = glow
  g.fillRect(0, 0, w, h)
  g.lineWidth = 1
  for (let r = 40, i = 0; r < Math.max(w, h) * 1.2; r += 46, i += 1) {
    g.strokeStyle = t.css('info', Math.max(0.03, (t.isDark ? 0.16 : 0.2) - i * 0.012))
    g.beginPath()
    g.arc(w / 2, h, r, Math.PI, Math.PI * 2)
    g.stroke()
  }
  g.fillStyle = t.css('cyan', t.isDark ? 0.35 : 0.3)
  for (let i = 0; i < 60; i += 1) {
    g.fillRect((((i * 97) % 101) / 101) * w, (((i * 61) % 89) / 89) * h, 1.5, 1.5)
  }
  return canvas
}

function paintOrca(
  g: CanvasRenderingContext2D,
  t: ArcadeTokens,
  x: number,
  y: number,
  u: number
): void {
  g.save()
  g.shadowColor = t.css('info', 0.8)
  g.shadowBlur = u * 0.6
  g.fillStyle = t.css('foreground')
  g.beginPath()
  g.ellipse(x, y, u * 1.15, u * 0.5, 0, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.moveTo(x - u * 0.25, y - u * 0.4)
  g.quadraticCurveTo(x + u * 0.05, y - u * 1.05, x + u * 0.12, y - u * 1.3)
  g.quadraticCurveTo(x + u * 0.2, y - u * 0.8, x + u * 0.35, y - u * 0.38)
  g.fill()
  g.beginPath()
  g.moveTo(x + u, y)
  g.lineTo(x + u * 1.55, y - u * 0.4)
  g.lineTo(x + u * 1.45, y + u * 0.05)
  g.lineTo(x + u * 1.55, y + u * 0.4)
  g.fill()
  g.restore()
  g.fillStyle = t.css('background')
  g.beginPath()
  g.ellipse(x - u * 0.05, y + u * 0.22, u * 0.7, u * 0.16, 0, 0, Math.PI * 2)
  g.ellipse(x - u * 0.62, y - u * 0.14, u * 0.2, u * 0.1, -0.3, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = t.css('info')
  g.beginPath()
  g.arc(x - u * 0.85, y - u * 0.06, Math.max(1, u * 0.07), 0, Math.PI * 2)
  g.fill()
}

function paintEnemy(
  g: CanvasRenderingContext2D,
  t: ArcadeTokens,
  board: ArcadeBoard,
  one: DefenseEnemy
): void {
  const u = board.cell
  const x = board.left + one.x * u
  const y = board.top + one.y * u
  if (one.kind === 'build') {
    // Why the fill fades on the last hit point: a build takes two pings, and the player sees which.
    g.fillStyle = t.css('attention', one.hp === 1 ? 0.45 : 0.9)
    g.strokeStyle = t.css('attention')
    g.lineWidth = 1.5
    g.shadowColor = t.css('attention', 0.7)
    g.shadowBlur = u * 0.5
    g.beginPath()
    g.roundRect(x - u * 0.45, y - u * 0.45, u * 0.9, u * 0.9, u * 0.2)
    g.fill()
    g.shadowBlur = 0
    g.stroke()
    g.strokeStyle = t.css('background')
    g.lineWidth = Math.max(1.5, u * 0.12)
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(x - u * 0.18, y - u * 0.18)
    g.lineTo(x + u * 0.18, y + u * 0.18)
    g.moveTo(x + u * 0.18, y - u * 0.18)
    g.lineTo(x - u * 0.18, y + u * 0.18)
    g.stroke()
    return
  }
  g.strokeStyle = t.css('warning')
  g.lineWidth = Math.max(1, u * 0.07)
  g.lineCap = 'round'
  g.beginPath()
  for (const side of [-1, 1]) {
    for (const row of [-0.18, 0.06, 0.3]) {
      g.moveTo(x + side * u * 0.15, y + row * u)
      g.lineTo(x + side * u * 0.45, y + (row + 0.12) * u)
    }
  }
  g.stroke()
  g.fillStyle = t.css('warning')
  g.shadowColor = t.css('warning', 0.7)
  g.shadowBlur = u * 0.4
  g.beginPath()
  g.ellipse(x, y + u * 0.06, u * 0.27, u * 0.36, 0, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.arc(x, y - u * 0.38, u * 0.15, 0, Math.PI * 2)
  g.fill()
  g.shadowBlur = 0
  g.strokeStyle = t.css('background', 0.7)
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(x, y - u * 0.26)
  g.lineTo(x, y + u * 0.4)
  g.stroke()
}

export function paintDefenseRun(
  g: CanvasRenderingContext2D,
  game: OrchestratorGameArcadeDefense,
  state: DefenseState,
  size: ArcadeBoardSize
): void {
  const t = arcadeTokens()
  const board = arcadeBoardOf(size, game.field)
  const u = board.cell
  const w = game.field.columns * u
  const h = game.field.rows * u
  g.fillStyle = t.css('background', 0.55)
  g.strokeStyle = t.css('info', 0.55)
  g.lineWidth = 1.5
  g.beginPath()
  g.roundRect(board.left - 4, board.top - 4, w + 8, h + 8, 10)
  g.fill()
  g.stroke()
  const line = board.top + defenseMergeLineOf(game) * u
  g.fillStyle = t.css('success', 0.1)
  g.fillRect(board.left, line, w, board.top + h - line)
  g.strokeStyle = t.css('success')
  g.shadowColor = t.css('success', 0.9)
  g.shadowBlur = 8
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(board.left, line)
  g.lineTo(board.left + w, line)
  g.stroke()
  g.shadowBlur = 0
  for (const one of state.enemies) {
    paintEnemy(g, t, board, one)
  }
  g.strokeStyle = t.css('info')
  g.shadowColor = t.css('info', 0.9)
  g.shadowBlur = u * 0.4
  g.lineWidth = Math.max(1.5, u * 0.1)
  g.lineCap = 'round'
  g.beginPath()
  for (const shot of state.shots) {
    const sx = board.left + shot.x * u
    const sy = board.top + shot.y * u
    g.moveTo(
      sx + u * 0.3 * Math.cos(Math.PI * 1.15),
      sy + u * 0.3 + u * 0.3 * Math.sin(Math.PI * 1.15)
    )
    g.arc(sx, sy + u * 0.3, u * 0.3, Math.PI * 1.15, Math.PI * 1.85)
  }
  g.stroke()
  g.shadowBlur = 0
  paintOrca(g, t, board.left + state.turret * u, line + u * 0.9, u)
  // Why below the line: the top row is where enemies fall in, and one would cover the lives.
  g.fillStyle = t.css('foreground', 0.85)
  for (let i = 0; i < state.lives; i += 1) {
    const lx = board.left + w - (i + 0.6) * u * 0.8
    const ly = line + u * 1.25
    g.beginPath()
    g.moveTo(lx - u * 0.2, ly)
    g.quadraticCurveTo(lx, ly - u * 0.25, lx + u * 0.05, ly - u * 0.45)
    g.lineTo(lx + u * 0.2, ly)
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
