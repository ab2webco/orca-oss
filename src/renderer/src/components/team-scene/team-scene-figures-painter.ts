import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import {
  drawFiguresSky,
  paintFiguresBackdrop,
  paintFiguresCloud
} from './team-scene-figures-backdrop'
import { PILE_FROM_SEAT_X, SITE_FROM_SEAT_X } from '../../../../shared/team-scene/team-scene-sites'
import { drawCastlePile, drawCastleSite, drawCastleTrophies } from './team-scene-castle-sites'
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
  const backdrop = createSceneBackdrop(paintFiguresBackdrop)
  const cloud = createSceneBackdrop(paintFiguresCloud)
  const effects = createSceneEffects(feetY)

  return {
    height: HEIGHT,
    headTop: (depth, h) => feetY(depth, h) - 58 * teamSceneScaleAt(depth),
    paint: (g, f: TeamSceneFrame) => {
      const { width: w, height: h } = f
      g.drawImage(backdrop.get(w, h, f.ratio), 0, 0, w, h)
      drawFiguresSky(g, cloud.get(240, 70, 2), w, h, f.t)
      drawCastleTrophies(g, f.trophies.length, w, feetY(0, h) - 14, f.t)
      if (f.sites.length === 0) {
        for (const spot of f.stations) {
          const s = teamSceneScaleAt(spot.depth)
          drawStation(g, spot.x * w + 18 * s, feetY(spot.depth, h), s)
        }
      }
      for (const site of f.sites) {
        const s = teamSceneScaleAt(site.spot.depth)
        const y = feetY(site.spot.depth, h)
        const seatX = site.spot.x - SITE_FROM_SEAT_X
        drawCastlePile(g, (seatX - PILE_FROM_SEAT_X) * w, y, s)
        drawCastleSite(g, site.spot.x * w, y, s, site, f.t)
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
      cloud.clear()
      effects.clear()
    }
  }
}
