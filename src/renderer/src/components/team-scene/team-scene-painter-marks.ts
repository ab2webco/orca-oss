import type {
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneEmote
} from '../../../../shared/team-scene/team-scene-types'
import { SITE_FROM_SEAT_X } from '../../../../shared/team-scene/team-scene-sites'
import type { TeamSceneFrame } from './team-scene-painter'

/** Status colours resolved from the theme; the scene uses them only for what they mean. */
export type TeamSceneStatusColors = { attention: string; done: string; working: string }

const TAU = 2 * Math.PI
const SCROLL = '#f4e6c0'
const SHOT_SECONDS = 0.55
export const SCENE_DUST = '#cfc6b4'

type Shot = { from: TeamSceneActor; to: TeamSceneActor; p: number }
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string }

export function drawSceneEmote(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: TeamSceneEmote,
  colors: TeamSceneStatusColors
): void {
  const background = {
    alert: colors.attention,
    check: colors.done,
    star: '#ffd24a',
    heart: '#ff8fa8'
  }
  g.save()
  g.translate(x, y)
  g.fillStyle = background[kind]
  g.beginPath()
  g.arc(0, 0, 7, 0, TAU)
  g.moveTo(-2.2, 5.8)
  g.lineTo(0, 10)
  g.lineTo(2.2, 5.8)
  g.fill()
  g.strokeStyle = '#fff'
  g.fillStyle = '#fff'
  g.lineWidth = 2
  g.lineCap = 'round'
  g.beginPath()
  if (kind === 'alert') {
    g.moveTo(0, -4)
    g.lineTo(0, 0.6)
    g.stroke()
    g.fillRect(-1, 2.6, 2, 2)
  } else if (kind === 'check') {
    g.moveTo(-3, 0.2)
    g.lineTo(-0.8, 2.6)
    g.lineTo(3.2, -2.4)
    g.stroke()
  } else {
    g.arc(0, 0, kind === 'star' ? 2.6 : 2.2, 0, TAU)
    g.fill()
  }
  g.restore()
}

/** Members past the seats; a number only, so it needs no translation. */
export function drawSceneOverflow(g: CanvasRenderingContext2D, overflow: number): void {
  if (overflow <= 0) {
    return
  }
  g.fillStyle = 'rgb(0 0 0 / 0.5)'
  g.beginPath()
  g.roundRect(6, 6, 30, 18, 9)
  g.fill()
  g.fillStyle = '#fff'
  g.font = '600 11px sans-serif'
  g.textAlign = 'center'
  g.fillText(`+${overflow}`, 21, 19)
  g.textAlign = 'start'
}

/** A backdrop drawn once per size and pixel ratio into an off-screen canvas. */
export function createSceneBackdrop(
  paint: (g: CanvasRenderingContext2D, w: number, h: number) => void
): {
  get: (w: number, h: number, ratio: number) => HTMLCanvasElement
  clear: () => void
} {
  let cached: { key: string; canvas: HTMLCanvasElement } | null = null
  return {
    get: (w, h, ratio) => {
      const key = `${w}x${h}@${ratio}`
      if (cached?.key !== key) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * ratio)
        canvas.height = Math.round(h * ratio)
        const bg = canvas.getContext('2d')
        if (bg) {
          bg.scale(ratio, ratio)
          paint(bg, w, h)
        }
        cached = { key, canvas }
      }
      return cached.canvas
    },
    clear: () => {
      cached = null
    }
  }
}

/** Thrown reports and sparks, shared by every style that draws in scene px. */
export function createSceneEffects(feetY: (depth: number, h: number) => number): {
  start: (effects: TeamSceneEffect[], actors: TeamSceneActor[], h: number) => void
  draw: (g: CanvasRenderingContext2D, f: TeamSceneFrame) => void
  clear: () => void
} {
  let shots: Shot[] = []
  let sparks: Spark[] = []
  const startOne = (effect: TeamSceneEffect, actors: TeamSceneActor[], h: number): void => {
    const find = (key: string) => actors.find((a) => a.key === key)
    if (effect.kind === 'handoff') {
      const from = find(effect.from)
      const to = find(effect.to)
      if (from && to) {
        shots.push({ from, to, p: 0 })
      }
      return
    }
    const at = find(effect.key)
    if (!at) {
      return
    }
    if (effect.reason === 'build' || effect.reason === 'repair') {
      // Why low and small: a puff at the build, not a celebration over the head.
      for (let i = 0; i < 6; i++) {
        sparks.push({
          x: at.x + SITE_FROM_SEAT_X,
          y: feetY(at.depth, h) - 4,
          vx: (i - 2.5) * 9,
          vy: -18 - (i % 3) * 8,
          life: 0.8,
          color: SCENE_DUST
        })
      }
      return
    }
    const palette =
      effect.reason === 'merge' ? ['#ffd27a', '#fff2c0', '#ff9d4a'] : ['#ffd24a', '#fff']
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * TAU
      sparks.push({
        x: at.x,
        y: feetY(at.depth, h) - 36,
        vx: Math.cos(angle) * 60,
        vy: Math.sin(angle) * 60 - 30,
        life: 1,
        color: palette[i % palette.length]!
      })
    }
  }

  return {
    start: (effects, actors, h) => {
      for (const effect of effects) {
        startOne(effect, actors, h)
      }
    },
    draw: (g, f) => {
      const { width: w, height: h } = f
      shots = shots.filter((shot) => {
        shot.p += f.dt / SHOT_SECONDS
        if (shot.p >= 1) {
          return false
        }
        const x = (shot.from.x + (shot.to.x - shot.from.x) * shot.p) * w
        const y = feetY(shot.from.depth, h) - 28 - Math.sin(shot.p * Math.PI) * 24
        g.save()
        g.translate(x, y)
        g.fillStyle = SCROLL
        g.rotate(shot.p * 6)
        g.fillRect(-4, -3, 8, 6)
        g.restore()
        return true
      })
      sparks = sparks.filter((spark) => {
        spark.life -= f.dt * 1.6
        spark.x += (spark.vx * f.dt) / w
        spark.y += spark.vy * f.dt
        spark.vy += 150 * f.dt
        if (spark.life <= 0) {
          return false
        }
        g.globalAlpha = spark.life
        g.fillStyle = spark.color
        g.fillRect(spark.x * w, spark.y, 2, 2)
        g.globalAlpha = 1
        return true
      })
    },
    clear: () => {
      shots = []
      sparks = []
    }
  }
}
