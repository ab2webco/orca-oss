import {
  HERO_HITBOX,
  runnerHeightOf
} from '../../../../shared/orchestrator-game-arcade-runner-rules'
import type { ArcadeRun } from './arcade-run-state'
import type { ArcadeWords } from './arcade-words'

// Draws one frame of the arcade tab, after prototype Version 28's run: a dusk backdrop baked once
// per size, a scrolling path, the game file's own obstacle sprites, coins and the hero. Scene art
// keeps its own colours; the overlay text takes the caller's translated words.

export type ArcadePaintSize = { width: number; height: number; scale: number }

const HERO = { body: '#2f5fb3', trim: '#f2c94c', cape: '#b3263a', leg: '#28324a', skin: '#f1c6a0' }

const ridge = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: number,
  amp: number,
  seed: number
): void => {
  g.beginPath()
  g.moveTo(0, h)
  for (let x = 0; x <= w; x += 4) {
    const wave = Math.sin(x * 0.012 + seed) + 0.5 * Math.sin(x * 0.031 + seed * 2.1)
    g.lineTo(x, base - amp * wave)
  }
  g.lineTo(w, h)
  g.closePath()
  g.fill()
}

/** The still part of the scene; the caller keeps it until the size changes. */
export function arcadeBackdropOf(size: ArcadePaintSize): HTMLCanvasElement {
  const { width: w, height: h, scale } = size
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const g = canvas.getContext('2d')
  if (!g) {
    return canvas
  }
  g.scale(scale, scale)
  const sky = g.createLinearGradient(0, 0, 0, h * 0.72)
  sky.addColorStop(0, '#27365f')
  sky.addColorStop(0.45, '#7d6f9e')
  sky.addColorStop(0.8, '#f0a57a')
  sky.addColorStop(1, '#fcd9a0')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  const sun = g.createRadialGradient(w * 0.72, h * 0.5, 2, w * 0.72, h * 0.5, w * 0.55)
  sun.addColorStop(0, 'rgb(255 244 214 / 0.95)')
  sun.addColorStop(0.09, 'rgb(255 224 170 / 0.6)')
  sun.addColorStop(1, 'rgb(255 200 140 / 0)')
  g.fillStyle = sun
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#8a86b0'
  ridge(g, w, h, h * 0.5, 13, 1.2)
  g.fillStyle = '#5f6f93'
  ridge(g, w, h, h * 0.6, 10, 3.1)
  g.fillStyle = '#3d5a5c'
  ridge(g, w, h, h * 0.72, 6, 5.4)
  const grass = g.createLinearGradient(0, h * 0.76, 0, h)
  grass.addColorStop(0, '#6f8f45')
  grass.addColorStop(1, '#2c4a2c')
  g.fillStyle = grass
  g.fillRect(0, h * 0.78, w, h)
  const path = g.createLinearGradient(0, h * 0.84, 0, h)
  path.addColorStop(0, '#dcbb8a')
  path.addColorStop(1, '#9c7a50')
  g.fillStyle = path
  g.fillRect(0, h * 0.86, w, h * 0.11)
  return canvas
}

/** Pixels per world column and pixel row, and where the hero's hitbox starts on screen. */
export const arcadeGeometryOf = (
  w: number,
  h: number
): { unit: number; floor: number; heroX: number } => {
  const unit = Math.max(5, Math.min(14, h / 26))
  return { unit, floor: h * 0.9, heroX: Math.min(120, w * 0.2) }
}

function paintHero(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  isRunning: boolean
): void {
  const stride = isRunning ? Math.sin(t * 14) * 4 : 0
  g.save()
  g.translate(x, y)
  g.lineCap = 'round'
  g.strokeStyle = HERO.leg
  g.lineWidth = 4
  for (const side of [-1, 1]) {
    g.beginPath()
    g.moveTo(side * 2, -11)
    g.lineTo(side * 2 + stride * side, -1)
    g.stroke()
  }
  g.fillStyle = HERO.cape
  g.beginPath()
  g.moveTo(-6, -25)
  g.quadraticCurveTo(-13, -15, -11, -6)
  g.lineTo(3, -9)
  g.lineTo(3, -25)
  g.fill()
  g.fillStyle = HERO.body
  g.beginPath()
  g.roundRect(-7.5, -27, 15, 18, 5)
  g.fill()
  g.fillStyle = HERO.trim
  g.fillRect(-7.5, -14.5, 15, 2)
  g.fillStyle = HERO.skin
  g.beginPath()
  g.arc(0, -33, 8.4, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#1d1a22'
  g.beginPath()
  g.ellipse(2, -33, 1.2, 1.7, 0, 0, Math.PI * 2)
  g.ellipse(6, -33, 1, 1.6, 0, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

function paintCoin(g: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const w = Math.abs(Math.cos(t * 4)) * 7 + 2
  const glow = g.createRadialGradient(x, y, 1, x, y, 16)
  glow.addColorStop(0, 'rgb(255 225 120 / 0.55)')
  glow.addColorStop(1, 'rgb(255 225 120 / 0)')
  g.fillStyle = glow
  g.fillRect(x - 16, y - 16, 32, 32)
  g.fillStyle = '#f2c14e'
  g.beginPath()
  g.ellipse(x, y, w, 8, 0, 0, Math.PI * 2)
  g.fill()
}

function paintText(
  g: CanvasRenderingContext2D,
  run: ArcadeRun,
  words: ArcadeWords,
  w: number,
  h: number
): void {
  g.fillStyle = '#fff'
  g.font = '600 15px "Geist Mono", monospace'
  g.fillText(words.score, 16, 26, w - 32)
  g.font = '12px "Geist Mono", monospace'
  g.fillStyle = 'rgb(255 255 255 / 0.8)'
  g.fillText(run.screen === 'held' ? words.held : words.hint, 16, 44, w - 32)
  if (run.screen !== 'over' && run.screen !== 'held') {
    return
  }
  g.fillStyle = 'rgb(8 8 12 / 0.62)'
  g.fillRect(0, 0, w, h)
  g.textAlign = 'center'
  g.fillStyle = '#fff'
  g.font = '600 22px Geist, sans-serif'
  g.fillText(run.screen === 'over' ? words.over : words.held, w / 2, h / 2 - 6, w - 32)
  g.font = '14px Geist, sans-serif'
  g.fillStyle = 'rgb(255 255 255 / 0.8)'
  if (run.screen === 'over') {
    g.fillText(words.overHint, w / 2, h / 2 + 18, w - 32)
  }
  g.textAlign = 'left'
}

export function paintArcadeFrame(
  g: CanvasRenderingContext2D,
  backdrop: HTMLCanvasElement,
  run: ArcadeRun,
  words: ArcadeWords,
  size: ArcadePaintSize
): void {
  const { width: w, height: h, scale } = size
  const { unit, floor, heroX } = arcadeGeometryOf(w, h)
  const { state, runner } = run
  const t = state.ms / 1000
  // Why: world column `distance + HERO_HITBOX.left` sits under the hero's feet.
  const xOf = (column: number): number =>
    heroX + (column - state.distance - HERO_HITBOX.left) * unit
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.drawImage(backdrop, 0, 0)
  g.setTransform(scale, 0, 0, scale, 0, 0)
  g.fillStyle = 'rgb(60 40 20 / 0.22)'
  const gap = 70
  const offset = (state.distance * unit) % gap
  for (let x = -gap - offset; x < w + gap; x += gap) {
    g.beginPath()
    g.ellipse(x + 20, floor - 1, 13, 2.2, 0, 0, Math.PI * 2)
    g.fill()
  }
  for (const one of state.obstacles) {
    const shape = runner.shapes[one.shape]
    if (!shape) {
      continue
    }
    shape.rows.forEach((row, r) => {
      ;[...row].forEach((glyph, column) => {
        const color = shape.colors[glyph]
        if (glyph === '.' || color === undefined) {
          return
        }
        g.fillStyle = `#${color.toString(16).padStart(6, '0')}`
        const top = floor - (shape.rows.length - r) * unit
        g.fillRect(xOf(one.x + column), top, unit + 0.5, unit + 0.5)
      })
    })
  }
  for (const coin of state.coins) {
    paintCoin(g, xOf(coin.x) + unit / 2, floor - coin.h * unit, t)
  }
  const feet = runnerHeightOf(runner, state) * unit
  const shadow = 1 - Math.min(0.6, feet / 200)
  g.fillStyle = `rgb(0 0 0 / ${0.3 * shadow})`
  g.beginPath()
  g.ellipse(heroX, floor + 1, 20 * shadow, 5 * shadow, 0, 0, Math.PI * 2)
  g.fill()
  paintHero(
    g,
    heroX + (HERO_HITBOX.width * unit) / 2,
    floor - feet,
    t,
    run.screen === 'running' && feet === 0
  )
  paintText(g, run, words, w, h)
}
