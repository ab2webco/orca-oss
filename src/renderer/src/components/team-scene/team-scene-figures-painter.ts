import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import type {
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneEmote
} from '../../../../shared/team-scene/team-scene-types'
import { drawFigure } from './team-scene-figure-draw'
import { figureLookOf } from './team-scene-figure-looks'
import type { TeamSceneFrame, TeamScenePainter } from './team-scene-painter'

/** Status colours resolved from the theme; the scene uses them only for what they mean. */
export type TeamSceneStatusColors = { attention: string; done: string }

const HEIGHT = 176
const TAU = 2 * Math.PI
const SCROLL = '#f4e6c0'
const SHOT_SECONDS = 0.55
const feetY = (depth: number, h: number): number => h - 36 + depth * 22

type Shot = { from: TeamSceneActor; to: TeamSceneActor; p: number }
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string }

function paintBackdrop(g: CanvasRenderingContext2D, w: number, h: number): void {
  const sky = g.createLinearGradient(0, 0, 0, h * 0.72)
  sky.addColorStop(0, '#27365f')
  sky.addColorStop(0.45, '#7d6f9e')
  sky.addColorStop(0.8, '#f0a57a')
  sky.addColorStop(1, '#fcd9a0')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgb(255 255 255 / ${0.15 + ((i * 7) % 10) / 20})`
    g.fillRect((i * 97) % w, (i * 53) % (h * 0.34), 1, 1)
  }
  const ridge = (base: number, amp: number, seed: number, fill: string): void => {
    g.beginPath()
    g.moveTo(0, h)
    for (let x = 0; x <= w; x += 4) {
      g.lineTo(
        x,
        base - amp * (Math.sin(x * 0.012 + seed) + 0.5 * Math.sin(x * 0.031 + seed * 2.1))
      )
    }
    g.lineTo(w, h)
    g.closePath()
    g.fillStyle = fill
    g.fill()
  }
  ridge(h * 0.5, 13, 1.2, '#8a83ad')
  ridge(h * 0.6, 10, 3.1, '#5f6f94')
  ridge(h * 0.72, 6, 5.4, '#33524a')
  const ground = g.createLinearGradient(0, h * 0.76, 0, h)
  ground.addColorStop(0, '#6f8f45')
  ground.addColorStop(1, '#2c4a2c')
  g.fillStyle = ground
  g.fillRect(0, h * 0.78, w, h)
  g.fillStyle = '#c7a674'
  g.fillRect(0, h * 0.86, w, h * 0.1)
}

function drawStation(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save()
  g.translate(x, y)
  g.scale(s, s)
  g.fillStyle = '#4a3a2c'
  g.fillRect(-12, -15, 24, 3)
  g.fillRect(-10, -12, 2.5, 12)
  g.fillRect(7.5, -12, 2.5, 12)
  g.fillStyle = '#7c8794'
  g.fillRect(-6, -20, 12, 5)
  g.restore()
}

function drawEmote(
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

/** The Figures style: painted characters at stations under a dusk sky. */
export function createFiguresPainter(colors: TeamSceneStatusColors): TeamScenePainter {
  let backdrop: { key: string; canvas: HTMLCanvasElement } | null = null
  let shots: Shot[] = []
  let sparks: Spark[] = []

  const backdropFor = (w: number, h: number, ratio: number): HTMLCanvasElement => {
    const key = `${w}x${h}@${ratio}`
    if (backdrop?.key !== key) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * ratio)
      canvas.height = Math.round(h * ratio)
      const bg = canvas.getContext('2d')
      bg?.scale(ratio, ratio)
      if (bg) {
        paintBackdrop(bg, w, h)
      }
      backdrop = { key, canvas }
    }
    return backdrop.canvas
  }

  const start = (effect: TeamSceneEffect, actors: TeamSceneActor[], h: number): void => {
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
    height: HEIGHT,
    headTop: (depth, h) => feetY(depth, h) - 58 * teamSceneScaleAt(depth),
    paint: (g, f: TeamSceneFrame) => {
      const { width: w, height: h } = f
      g.drawImage(backdropFor(w, h, f.ratio), 0, 0, w, h)
      for (const spot of f.stations) {
        const s = teamSceneScaleAt(spot.depth)
        drawStation(g, spot.x * w + 18 * s, feetY(spot.depth, h), s)
      }
      for (const effect of f.effects) {
        start(effect, f.actors, h)
      }
      for (const a of f.actors) {
        const x = a.x * w
        const y = feetY(a.depth, h)
        const s = teamSceneScaleAt(a.depth)
        g.fillStyle = a.emote === 'alert' ? colors.attention : 'rgb(20 20 30 / 0.4)'
        g.globalAlpha = a.emote === 'alert' ? 0.6 : 1
        g.beginPath()
        g.ellipse(x, y + 1, 14 * s, 4 * s, 0, 0, TAU)
        g.fill()
        g.globalAlpha = 1
        g.save()
        g.translate(x, y - a.jump)
        g.scale(s * a.facing, s)
        drawFigure(g, figureLookOf(a), {
          t: f.t + a.x * 7,
          pose: a.pose,
          gait: a.gait,
          carrying: a.carrying
        })
        g.restore()
        if (a.emote) {
          drawEmote(g, x, y - a.jump - 60 * s, a.emote, colors)
        }
      }
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
      if (f.overflow > 0) {
        g.fillStyle = 'rgb(0 0 0 / 0.5)'
        g.beginPath()
        g.roundRect(6, 6, 30, 18, 9)
        g.fill()
        g.fillStyle = '#fff'
        g.font = '600 11px sans-serif'
        g.textAlign = 'center'
        g.fillText(`+${f.overflow}`, 21, 19)
        g.textAlign = 'start'
      }
    },
    dispose: () => {
      backdrop = null
      shots = []
      sparks = []
    }
  }
}
