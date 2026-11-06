import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { drawOfficeFigure, OFFICE_FIGURE_SCALE, officeLookOf } from './team-scene-office-figure'
import type { TeamSceneFrame, TeamScenePainter } from './team-scene-painter'
import {
  createSceneBackdrop,
  createSceneEffects,
  drawSceneEmote,
  drawSceneOverflow,
  type TeamSceneStatusColors
} from './team-scene-painter-marks'

export const OFFICE_SCREEN_OFF = '#0a0c10'
const SCREEN_ON = '#0f1826'
const HEIGHT = 176
const TAU = 2 * Math.PI
const WALL = 104
const feetY = (depth: number, h: number): number => h - 36 + depth * 22

function paintOffice(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#1c2029'
  g.fillRect(0, 0, w, WALL)
  const glass = w * 0.76
  const sky = g.createLinearGradient(0, 6, 0, WALL - 4)
  sky.addColorStop(0, '#2b2f5c')
  sky.addColorStop(0.55, '#b86a78')
  sky.addColorStop(1, '#f4b271')
  g.fillStyle = sky
  g.fillRect(0, 6, glass, WALL - 10)
  g.save()
  g.beginPath()
  g.rect(0, 6, glass, WALL - 10)
  g.clip()
  for (let b = 0; b < 20; b++) {
    const bx = (b * glass) / 18 - 6
    const bh = 26 + ((b * 37) % 48)
    const bw = 14 + ((b * 13) % 12)
    g.fillStyle = b % 2 ? '#23274a' : '#2d3158'
    g.fillRect(bx, WALL - 4 - bh, bw, bh)
    g.fillStyle = 'rgb(255 222 160 / 0.75)'
    for (let r = 0; r < bh / 8; r++) {
      for (let q = 0; q < 3; q++) {
        if ((b + r * 2 + q) % 3) {
          g.fillRect(bx + 2 + q * 4, WALL - 4 - bh + 3 + r * 7, 1.6, 2.6)
        }
      }
    }
  }
  g.restore()
  g.fillStyle = '#14171e'
  for (let i = 0; i <= 5; i++) {
    g.fillRect((i * glass) / 5 - 1, 6, 2.4, WALL - 10)
  }
  g.fillRect(0, 5, glass, 2.5)
  g.fillRect(0, 30, glass, 1.2)
  g.fillRect(0, 0, w, 6)
  for (const x of [0.16, 0.4, 0.64]) {
    g.strokeStyle = '#0c0e13'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(w * x, 0)
    g.lineTo(w * x, 22)
    g.stroke()
    g.fillStyle = '#2a2e38'
    g.beginPath()
    g.moveTo(w * x - 10, 28)
    g.lineTo(w * x - 5, 22)
    g.lineTo(w * x + 5, 22)
    g.lineTo(w * x + 10, 28)
    g.closePath()
    g.fill()
    const lamp = g.createRadialGradient(w * x, 30, 1, w * x, 60, 74)
    lamp.addColorStop(0, 'rgb(255 224 170 / 0.34)')
    lamp.addColorStop(1, 'rgb(255 224 170 / 0)')
    g.fillStyle = lamp
    g.fillRect(w * x - 78, 28, 156, 110)
  }
  const room = w * 0.77
  g.fillStyle = '#262b36'
  g.fillRect(room, 6, w - room, WALL - 6)
  const board = w * 0.15
  g.fillStyle = '#e6eaf0'
  g.fillRect(room + 10, 24, board, 46)
  ;['#ffd24a', '#7fd1ae', '#8ab8ff', '#ffa8a8'].forEach((note, i) => {
    for (let r = 0; r < 3 - (i % 2); r++) {
      g.fillStyle = note
      g.fillRect(room + 14 + (i * board) / 4.4, 29 + r * 13, board / 6.5, 9)
    }
  })
  g.fillStyle = 'rgb(170 205 230 / 0.1)'
  g.fillRect(room, 6, w - room, WALL - 6)
  g.strokeStyle = 'rgb(200 225 245 / 0.35)'
  g.strokeRect(room, 6, w - room - 1, WALL - 6)
  const floor = g.createLinearGradient(0, WALL, 0, h)
  floor.addColorStop(0, '#4b4f58')
  floor.addColorStop(1, '#2c2f37')
  g.fillStyle = floor
  g.fillRect(0, WALL, w, h - WALL)
  g.fillStyle = 'rgb(244 178 113 / 0.1)'
  for (let i = 0; i < 5; i++) {
    g.beginPath()
    g.moveTo((i * glass) / 5 + 6, WALL)
    g.lineTo(((i + 1) * glass) / 5 - 4, WALL)
    g.lineTo(((i + 1) * glass) / 5 + 26, h)
    g.lineTo((i * glass) / 5 + 30, h)
    g.closePath()
    g.fill()
  }
  g.fillStyle = '#14171e'
  g.fillRect(0, WALL - 2, w, 2.4)
  const px = w * 0.97
  g.fillStyle = '#d9d4c8'
  g.fillRect(px - 7, 108, 14, 16)
  g.fillStyle = '#2f7a56'
  for (let i = -4; i <= 4; i++) {
    g.beginPath()
    g.ellipse(px + i * 3, 97 - (4 - Math.abs(i)) * 4, 2.6, 13, i * 0.3, 0, TAU)
    g.fill()
  }
}

type Screen = { background: string; line: string | null }

function drawDesk(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  dir: 1 | -1,
  screen: Screen,
  t: number
): void {
  g.save()
  g.translate(x, y)
  g.scale(s * dir, s)
  g.fillStyle = '#14171e'
  g.fillRect(-11, -1.5, 14, 1.6)
  g.fillRect(-5, -9, 2.4, 8)
  g.fillRect(-13, -11, 19, 3.4)
  g.fillRect(-15, -31, 4, 20)
  g.fillStyle = '#d8d4cc'
  g.fillRect(12, -23, 40, 2.6)
  g.fillStyle = '#1b1e26'
  g.fillRect(15, -21, 2.2, 21)
  g.fillRect(47, -21, 2.2, 21)
  g.fillRect(33, -29, 3, 6.5)
  g.fillStyle = '#0e1117'
  g.fillRect(20, -49, 31, 21)
  g.fillStyle = screen.background
  g.fillRect(21.5, -47.5, 28, 18)
  if (screen.line) {
    for (let i = 0; i < 5; i++) {
      const n = (Math.floor(t * 3) + i * 3) % 7
      g.fillStyle = i % 2 ? screen.line : '#a8b4c8'
      g.fillRect(23 + (n % 3) * 2, -46 + i * 3.3, 6 + ((n * 11) % 16), 1.4)
    }
  }
  g.restore()
}

/** The Office style: adults at desks whose screens show what each one is doing. */
export function createOfficePainter(colors: TeamSceneStatusColors): TeamScenePainter {
  const backdrop = createSceneBackdrop(paintOffice)
  const effects = createSceneEffects(feetY)

  const screenOf = (seated: TeamSceneActor | undefined): Screen => {
    if (!seated) {
      return { background: OFFICE_SCREEN_OFF, line: null }
    }
    if (seated.emote === 'alert') {
      return { background: SCREEN_ON, line: colors.attention }
    }
    return { background: SCREEN_ON, line: seated.pose === 'work' ? colors.working : null }
  }

  return {
    height: HEIGHT,
    headTop: (depth, h) => feetY(depth, h) - 70 * teamSceneScaleAt(depth),
    paint: (g, f: TeamSceneFrame) => {
      const { width: w, height: h } = f
      g.drawImage(backdrop.get(w, h, f.ratio), 0, 0, w, h)
      effects.start(f.effects, f.actors, h)
      const seatedAt = new Map<number, TeamSceneActor>()
      f.stations.forEach((spot, i) => {
        const seated = f.actors.find(
          (a) => a.role === 'member' && a.pose !== 'walk' && Math.abs((a.x - spot.x) * w) < 2
        )
        if (seated) {
          seatedAt.set(i, seated)
        }
        const dir = i % 2 === 0 ? 1 : -1
        const s = teamSceneScaleAt(spot.depth) * OFFICE_FIGURE_SCALE
        drawDesk(g, spot.x * w, feetY(spot.depth, h), s, dir, screenOf(seated), f.t)
      })
      const seatedKeys = new Map([...seatedAt].map(([i, a]) => [a.key, i % 2 === 0 ? 1 : -1]))
      for (const a of f.actors) {
        const x = a.x * w
        const y = feetY(a.depth, h)
        const s = teamSceneScaleAt(a.depth) * OFFICE_FIGURE_SCALE
        const deskDir = seatedKeys.get(a.key)
        g.fillStyle = a.emote === 'alert' ? colors.attention : 'rgb(10 10 15 / 0.45)'
        g.globalAlpha = a.emote === 'alert' ? 0.6 : 1
        g.beginPath()
        g.ellipse(x, y + 1, 16 * s, 4 * s, 0, 0, TAU)
        g.fill()
        g.globalAlpha = 1
        g.save()
        g.translate(x, y - a.jump)
        g.scale(s * (deskDir ?? a.facing), s)
        drawOfficeFigure(g, officeLookOf(a), {
          t: f.t + a.x * 7,
          pose: a.pose,
          gait: a.gait,
          carrying: a.carrying,
          seated: deskDir !== undefined && a.pose !== 'cheer'
        })
        g.restore()
        if (a.emote) {
          drawSceneEmote(g, x, y - a.jump - 58 * s, a.emote, colors)
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
