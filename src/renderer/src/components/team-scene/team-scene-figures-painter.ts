import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import { drawFigure } from './team-scene-figure-draw'
import { figureLookOf } from './team-scene-figure-looks'
import type { TeamSceneFrame, TeamScenePainter } from './team-scene-painter'
import {
  createSceneBackdrop,
  createSceneEffects,
  drawSceneEmote,
  drawSceneOverflow,
  type TeamSceneStatusColors
} from './team-scene-painter-marks'

const HEIGHT = 176
const TAU = 2 * Math.PI
const feetY = (depth: number, h: number): number => h - 36 + depth * 22

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

/** The Figures style: painted characters at stations under a dusk sky. */
export function createFiguresPainter(colors: TeamSceneStatusColors): TeamScenePainter {
  const backdrop = createSceneBackdrop(paintBackdrop)
  const effects = createSceneEffects(feetY)

  return {
    height: HEIGHT,
    headTop: (depth, h) => feetY(depth, h) - 58 * teamSceneScaleAt(depth),
    paint: (g, f: TeamSceneFrame) => {
      const { width: w, height: h } = f
      g.drawImage(backdrop.get(w, h, f.ratio), 0, 0, w, h)
      for (const spot of f.stations) {
        const s = teamSceneScaleAt(spot.depth)
        drawStation(g, spot.x * w + 18 * s, feetY(spot.depth, h), s)
      }
      effects.start(f.effects, f.actors, h)
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
          drawSceneEmote(g, x, y - a.jump - 60 * s, a.emote, colors)
        }
      }
      effects.draw(g, f)
      drawSceneOverflow(g, f.overflow)
    },
    dispose: () => {
      backdrop.clear()
      effects.clear()
    }
  }
}
