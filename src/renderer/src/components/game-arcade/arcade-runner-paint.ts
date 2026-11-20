import {
  HERO_HITBOX,
  runnerHeightOf,
  type Runner,
  type RunnerState
} from '../../../../shared/orchestrator-game-arcade-runner-rules'
import type { ArcadePaintSize } from './arcade-canvas-paint'
import type { ArcadeView } from './arcade-run-state'
import type { ArcadeSpriteShape } from './arcade-driver-runner'
import { arcadeTokens, type ArcadeTokens } from './arcade-theme-tokens'

// Draws Endless run as a night track toward a lit skyline: a backdrop baked once per size and
// theme, a scrolling perspective floor, the game file's obstacle shapes as lit blocks, coins and
// the hero. Every colour is an app token, read at draw time.

/** Where the runner's sky meets its floor, and the line its feet run on. */
const horizonOf = (h: number): number => h * 0.62

/** A deterministic 0..1 noise, so the skyline is the same every bake. */
const noiseOf = (i: number): number => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

type SkylineLayer = { seed: number; tall: number; fill: string; edge: string; lit: number }

function paintSkylineLayer(
  g: CanvasRenderingContext2D,
  t: ArcadeTokens,
  w: number,
  base: number,
  layer: SkylineLayer
): void {
  for (let i = layer.seed, x = 0; x < w; i += 1) {
    const width = 14 + noiseOf(i) * 30
    const height =
      base *
      layer.tall *
      (0.35 + noiseOf(i + 40) * 0.65) *
      (0.6 + 0.4 * Math.sin((x / w) * Math.PI))
    g.fillStyle = layer.fill
    g.fillRect(x, base - height, width - 2, height)
    g.fillStyle = layer.edge
    g.fillRect(x, base - height, width - 2, 1.5)
    g.fillStyle = t.css(i % 3 === 0 ? 'violet' : 'info', layer.lit)
    for (let y = base - height + 5; y < base - 4; y += 6) {
      for (let wx = x + 3; wx < x + width - 5; wx += 5) {
        if (noiseOf(wx * 7 + y) > 0.74) {
          g.fillRect(wx, y, 2, 2)
        }
      }
    }
    x += width
  }
}

/** Two rows of towers: a pale far row and a nearer, darker one, so the city has depth. */
function paintSkyline(g: CanvasRenderingContext2D, t: ArcadeTokens, w: number, base: number): void {
  const ink = t.isDark ? 'foreground' : 'mutedForeground'
  paintSkylineLayer(g, t, w, base, {
    seed: 7,
    tall: 0.5,
    fill: t.css(ink, t.isDark ? 0.05 : 0.1),
    edge: t.css('violet', t.isDark ? 0.5 : 0.35),
    lit: t.isDark ? 0.35 : 0.3
  })
  paintSkylineLayer(g, t, w, base, {
    seed: 0,
    tall: 0.3,
    fill: t.css(ink, t.isDark ? 0.1 : 0.2),
    edge: t.css('info', t.isDark ? 0.7 : 0.55),
    lit: t.isDark ? 0.75 : 0.6
  })
}

/** The still part of the scene; the caller keeps it until the size or the theme changes. */
export function arcadeBackdropOf(size: ArcadePaintSize): HTMLCanvasElement {
  const { width: w, height: h, scale } = size
  const t = arcadeTokens()
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const g = canvas.getContext('2d')
  if (!g) {
    return canvas
  }
  g.scale(scale, scale)
  const horizon = horizonOf(h)
  const sky = g.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, t.css('background'))
  sky.addColorStop(1, t.css('muted'))
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  const halo = g.createRadialGradient(w * 0.62, horizon, 4, w * 0.62, horizon, Math.max(w, h) * 0.6)
  halo.addColorStop(0, t.css('violet', t.isDark ? 0.38 : 0.2))
  halo.addColorStop(0.45, t.css('info', t.isDark ? 0.12 : 0.07))
  halo.addColorStop(1, t.css('info', 0))
  g.fillStyle = halo
  g.fillRect(0, 0, w, horizon)
  paintSkyline(g, t, w, horizon)
  const ground = g.createLinearGradient(0, horizon, 0, h)
  ground.addColorStop(0, t.css('muted'))
  ground.addColorStop(1, t.css('background'))
  g.fillStyle = ground
  g.fillRect(0, horizon, w, h - horizon)
  // Why rays from one point: the floor reads as depth without a texture.
  g.strokeStyle = t.css('mutedForeground', t.isDark ? 0.16 : 0.2)
  g.lineWidth = 1
  g.beginPath()
  for (let i = -12; i <= 12; i += 1) {
    g.moveTo(w * 0.5 + i * 6, horizon)
    g.lineTo(w * 0.5 + i * w * 0.16, h)
  }
  g.stroke()
  g.fillStyle = t.css('info', t.isDark ? 0.9 : 0.75)
  g.fillRect(0, horizon - 0.5, w, 1)
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
  t: ArcadeTokens,
  x: number,
  y: number,
  time: number,
  isRunning: boolean
): void {
  const stride = isRunning ? Math.sin(time * 14) : 0
  g.save()
  g.translate(x, y)
  g.lineCap = 'round'
  if (isRunning) {
    g.strokeStyle = t.css('info', 0.45)
    g.lineWidth = 1.5
    g.beginPath()
    for (const [dy, len] of [
      [-30, 14],
      [-21, 22],
      [-12, 10]
    ] as const) {
      const shift = ((time * 90 + dy * 3) % 12) - 6
      g.moveTo(-14 - shift, dy)
      g.lineTo(-14 - shift - len, dy)
    }
    g.stroke()
  }
  g.strokeStyle = t.css('foreground')
  g.lineWidth = 3.5
  for (const side of [-1, 1]) {
    g.beginPath()
    g.moveTo(side * 2, -11)
    g.lineTo(side * 2 + stride * side * 5, -1)
    g.moveTo(side * 3, -24)
    g.lineTo(side * 3 - stride * side * 5, -15)
    g.stroke()
  }
  g.fillStyle = t.css('foreground')
  g.beginPath()
  g.roundRect(-6.5, -27, 13, 17, 6)
  g.fill()
  g.beginPath()
  g.arc(0, -33.5, 7.5, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = t.css('info')
  g.shadowColor = t.css('info', 0.9)
  g.shadowBlur = 8
  g.beginPath()
  g.roundRect(-0.5, -36.5, 8.5, 4.2, 2.1)
  g.fill()
  g.fillRect(-6.5, -20, 13, 1.6)
  g.restore()
}

function paintCoin(
  g: CanvasRenderingContext2D,
  t: ArcadeTokens,
  x: number,
  y: number,
  time: number
): void {
  const half = Math.abs(Math.cos(time * 4)) * 6 + 1.5
  const glow = g.createRadialGradient(x, y, 1, x, y, 15)
  glow.addColorStop(0, t.css('warning', 0.5))
  glow.addColorStop(1, t.css('warning', 0))
  g.fillStyle = glow
  g.fillRect(x - 15, y - 15, 30, 30)
  g.fillStyle = t.css('warning')
  g.beginPath()
  g.moveTo(x, y - 8)
  g.lineTo(x + half, y)
  g.lineTo(x, y + 8)
  g.lineTo(x - half, y)
  g.closePath()
  g.fill()
  g.fillStyle = t.css('background', 0.5)
  g.fillRect(x - half * 0.3, y - 3, half * 0.6, 6)
}

/** The floor's cross lines, closer together toward the horizon, sliding as the hero runs. */
function paintFloor(
  g: CanvasRenderingContext2D,
  t: ArcadeTokens,
  w: number,
  h: number,
  floor: number,
  travelled: number
): void {
  const horizon = horizonOf(h)
  const phase = (travelled / 90) % 1
  g.lineWidth = 1
  for (let i = 0; i < 9; i += 1) {
    const depth = (i + 1 - phase) / 9
    const y = horizon + (floor - horizon) * depth * depth
    g.strokeStyle = t.css('mutedForeground', 0.06 + 0.16 * depth)
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(w, y)
    g.stroke()
  }
  const track = g.createLinearGradient(0, floor, 0, h)
  track.addColorStop(0, t.css('card'))
  track.addColorStop(1, t.css('background'))
  g.fillStyle = track
  g.fillRect(0, floor, w, h - floor)
  g.fillStyle = t.css('info')
  g.shadowColor = t.css('info', 0.8)
  g.shadowBlur = 6
  g.fillRect(0, floor, w, 1.5)
  g.shadowBlur = 0
  g.fillStyle = t.css('info', 0.35)
  const gap = 44
  for (let x = -(travelled % gap); x < w; x += gap) {
    g.fillRect(x, floor + (h - floor) * 0.45, 18, 2)
  }
}

/** The runner's floor, obstacles, coins and hero over the backdrop. */
export function paintRunnerRun(
  g: CanvasRenderingContext2D,
  runner: Runner<ArcadeSpriteShape>,
  state: RunnerState,
  view: ArcadeView & { isMoving: boolean }
): void {
  const t = arcadeTokens()
  const { width: w, height: h } = view
  const { unit, floor, heroX } = arcadeGeometryOf(w, h)
  const time = state.ms / 1000
  // Why: world column `distance + HERO_HITBOX.left` sits under the hero's feet.
  const xOf = (column: number): number =>
    heroX + (column - state.distance - HERO_HITBOX.left) * unit
  paintFloor(g, t, w, h, floor, state.distance * unit)
  for (const one of state.obstacles) {
    const shape = runner.shapes[one.shape]
    if (!shape) {
      continue
    }
    const left = xOf(one.x)
    const glow = g.createRadialGradient(
      left + (shape.rows[0]?.length ?? 0) * unit * 0.5,
      floor,
      1,
      left + (shape.rows[0]?.length ?? 0) * unit * 0.5,
      floor,
      unit * 4
    )
    glow.addColorStop(0, t.css('attention', 0.35))
    glow.addColorStop(1, t.css('attention', 0))
    g.fillStyle = glow
    g.fillRect(left - unit * 3, floor - unit * 4, unit * 10, unit * 5)
    // Why the file's glyphs pick a shade, not a colour: the token owns the hue in both themes.
    const glyphs = Object.keys(shape.colors)
    shape.rows.forEach((row, r) => {
      ;[...row].forEach((glyph, column) => {
        const shade = glyphs.indexOf(glyph)
        if (glyph === '.' || shade === -1) {
          return
        }
        const top = floor - (shape.rows.length - r) * unit
        g.fillStyle = t.css('attention', shade === 0 ? 0.92 : 0.62)
        g.beginPath()
        g.roundRect(
          xOf(one.x + column) + 0.5,
          top + 0.5,
          unit - 1,
          unit - 1,
          Math.min(3, unit * 0.25)
        )
        g.fill()
      })
    })
  }
  for (const coin of state.coins) {
    paintCoin(g, t, xOf(coin.x) + unit / 2, floor - coin.h * unit, time)
  }
  const feet = runnerHeightOf(runner, state) * unit
  const lift = 1 - Math.min(0.6, feet / 200)
  const pool = g.createRadialGradient(heroX + 6, floor, 1, heroX + 6, floor, 22 * lift)
  pool.addColorStop(0, t.css('info', 0.4 * lift))
  pool.addColorStop(1, t.css('info', 0))
  g.fillStyle = pool
  g.fillRect(heroX - 20, floor - 8, 52, 16)
  paintHero(
    g,
    t,
    heroX + (HERO_HITBOX.width * unit) / 2,
    floor - feet,
    time,
    view.isMoving && feet === 0
  )
}
