import type { TeamScenePose } from '../../../../shared/team-scene/team-scene-types'
import type { FigureLook } from './team-scene-figure-looks'

/** Half a stride in figure units: the simulation's stride is 2 x this x the depth scale. */
export const FIGURE_FOOT_REACH = 4.4
const BONE = 6
const STEP_LIFT = 2.8
const WORK_SWING_SECONDS = 1.15

const shade = (hex: string, k: number): string => {
  const n = Number.parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(v * k)))
  )
  return `rgb(${c.join(' ')})`
}

/** Foot position against the hip: flat on the ground and sliding back for the whole stance. */
export function footOffsetOf(gait: number): { x: number; y: number } {
  const u = ((gait % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  if (u < Math.PI) {
    return { x: FIGURE_FOOT_REACH * (1 - (2 * u) / Math.PI), y: 0 }
  }
  const k = (u - Math.PI) / Math.PI
  const eased = k * k * (3 - 2 * k)
  return {
    x: -FIGURE_FOOT_REACH + 2 * FIGURE_FOOT_REACH * eased,
    y: -Math.sin(k * Math.PI) * STEP_LIFT
  }
}

function drawHat(g: CanvasRenderingContext2D, l: FigureLook): void {
  g.beginPath()
  if (l.hat === 'crown') {
    g.fillStyle = l.trim
    for (const [x, y] of [
      [-7, -37],
      [-8, -44],
      [-3.5, -40],
      [0, -46],
      [3.5, -40],
      [8, -44],
      [7, -37]
    ]) {
      g.lineTo(x!, y!)
    }
    g.closePath()
  } else if (l.hat === 'helm') {
    const m = g.createLinearGradient(-8, -44, 8, -30)
    m.addColorStop(0, '#eef2f7')
    m.addColorStop(1, '#7a8698')
    g.fillStyle = m
    g.arc(0, -33, 9.2, Math.PI * 1.02, Math.PI * 1.98)
    g.lineTo(9, -31)
    g.lineTo(-9, -33)
  } else if (l.hat === 'cap') {
    g.fillStyle = l.cape
    g.arc(0, -33, 8.8, Math.PI, 0)
    g.lineTo(11, -33)
  } else if (l.hat === 'band') {
    g.fillStyle = '#3b2a1e'
    g.arc(0, -34, 8.4, Math.PI, 0)
    g.fill()
    g.fillStyle = l.cape
    g.fillRect(-8.5, -36, 17, 2.4)
    return
  } else {
    g.fillStyle = shade(l.body, 0.8)
    g.moveTo(-11, -35)
    g.quadraticCurveTo(-2, -46, -6, -55)
    g.quadraticCurveTo(4, -48, 11, -35)
    g.quadraticCurveTo(0, -32, -11, -35)
  }
  g.fill()
}

function drawTool(
  g: CanvasRenderingContext2D,
  l: FigureLook,
  x: number,
  y: number,
  rot: number
): void {
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  if (l.tool === 'sword') {
    g.fillStyle = '#dfe6ee'
    g.beginPath()
    g.moveTo(-1.4, 0)
    g.lineTo(-1, -15)
    g.lineTo(0, -18)
    g.lineTo(1, -15)
    g.lineTo(1.4, 0)
    g.fill()
    g.fillStyle = l.trim
    g.fillRect(-3.5, -0.5, 7, 1.8)
  } else if (l.tool === 'hammer') {
    g.strokeStyle = '#5b3d24'
    g.lineWidth = 1.8
    g.beginPath()
    g.moveTo(0, 2)
    g.lineTo(0, -13)
    g.stroke()
    g.fillStyle = '#7c8794'
    g.fillRect(-4.5, -17, 9, 6)
  } else if (l.tool === 'staff') {
    g.strokeStyle = '#6b4a2a'
    g.lineWidth = 1.7
    g.beginPath()
    g.moveTo(0, 8)
    g.lineTo(0, -20)
    g.stroke()
    g.fillStyle = l.trim
    g.beginPath()
    g.arc(0, -22, 3, 0, 2 * Math.PI)
    g.fill()
  }
  g.restore()
}

type ArmAngle = { a: number; rot: number }

function armOf(pose: TeamScenePose, t: number, gait: number, carrying: boolean): ArmAngle {
  if (pose === 'raise' || pose === 'wave' || pose === 'cheer') {
    const a = 2.75 + Math.sin(t * 9) * 0.16
    return { a, rot: 3.1 - a }
  }
  if (pose === 'give') {
    return { a: 1.45, rot: 1.25 }
  }
  if (carrying) {
    return { a: 1.05, rot: 0.3 }
  }
  if (pose === 'work') {
    const q = 1 - ((t / WORK_SWING_SECONDS) % 1)
    const a = 0.3 + (q < 0.35 ? (q / 0.35) * 0.55 : 0.55 + ((q - 0.35) / 0.65) * 1.95)
    return { a, rot: 0.5 + (3.1 - a - 0.5) * Math.min(1, q * 4) }
  }
  return pose === 'walk'
    ? { a: Math.cos(gait) * 0.6, rot: 0.5 + Math.cos(gait) * 0.15 }
    : { a: 0.3 + Math.sin(t * 2) * 0.04, rot: 0.5 }
}

function drawLeg(
  g: CanvasRenderingContext2D,
  l: FigureLook,
  side: -1 | 1,
  walking: boolean,
  gait: number,
  bob: number
): void {
  const foot = walking ? footOffsetOf(gait + (side > 0 ? Math.PI : 0)) : { x: side * 2.4, y: 0 }
  const hx = side * 2
  const hy = -11 - bob
  const fx = foot.x + (walking ? side : 0)
  const dx = fx - hx
  const dy = foot.y - hy
  const reach = Math.min(Math.hypot(dx, dy), BONE * 2 - 0.01)
  const bend = Math.sqrt(Math.max(0, BONE * BONE - (reach * reach) / 4))
  const n = Math.hypot(dx, dy) || 1
  g.strokeStyle = side < 0 ? shade(l.leg, 0.8) : l.leg
  g.lineWidth = 4
  g.beginPath()
  g.moveTo(hx, hy)
  g.lineTo(hx + dx / 2 + (bend * dy) / n, hy + dy / 2 - (bend * dx) / n)
  g.lineTo(fx, foot.y - 1)
  g.stroke()
  g.fillStyle = '#2a221c'
  g.beginPath()
  g.ellipse(fx + 1.4, foot.y - 0.9, 3.8, 1.8, 0, 0, 2 * Math.PI)
  g.fill()
}

/** A side-profile figure facing right, feet at the origin; the caller scales and mirrors it. */
export function drawFigure(
  g: CanvasRenderingContext2D,
  l: FigureLook,
  p: { t: number; pose: TeamScenePose; gait: number; carrying: boolean }
): void {
  const walking = p.pose === 'walk'
  const bob = walking ? Math.abs(Math.sin(p.gait)) * 1.1 : Math.sin(p.t * 2.2) * 0.4
  g.lineCap = 'round'
  g.lineJoin = 'round'
  drawLeg(g, l, -1, walking, p.gait, bob)
  drawLeg(g, l, 1, walking, p.gait, bob)
  g.save()
  g.translate(0, -bob)
  g.rotate(walking ? 0.09 : 0)
  const sway = walking ? Math.sin(p.gait) * 1.4 : Math.sin(p.t * 1.6) * 0.6
  g.fillStyle = l.cape
  g.beginPath()
  g.moveTo(-6, -25)
  g.quadraticCurveTo(-13 - sway, -15, -11 - sway * 1.6, -6)
  g.quadraticCurveTo(-3, -7, 3, -9)
  g.lineTo(3, -25)
  g.fill()
  const torso = g.createLinearGradient(-8, -27, 8, -8)
  torso.addColorStop(0, shade(l.body, 1.25))
  torso.addColorStop(1, shade(l.body, 0.62))
  g.fillStyle = torso
  g.beginPath()
  g.roundRect(-7.5, -27, 15, 18, 5)
  g.fill()
  g.fillStyle = l.skin
  g.beginPath()
  g.arc(0, -33, 8.4, 0, 2 * Math.PI)
  g.fill()
  const blink = Math.sin(p.t * 0.9 + l.body.length) > 0.985 ? 0.25 : 1
  g.fillStyle = '#1d1a22'
  g.beginPath()
  g.ellipse(2, -33, 1.2, 1.7 * blink, 0, 0, 2 * Math.PI)
  g.ellipse(6, -33, 1, 1.6 * blink, 0, 0, 2 * Math.PI)
  g.fill()
  drawHat(g, l)
  const { a, rot } = armOf(p.pose, p.t, p.gait, p.carrying)
  const hx = 5 + Math.sin(a) * 9
  const hy = -23 + Math.cos(a) * 9
  if (l.tool !== 'shield') {
    drawTool(g, l, hx, hy, rot)
  }
  if (p.carrying) {
    g.fillStyle = '#f4e6c0'
    g.beginPath()
    g.roundRect(hx - 1, hy - 5, 9, 6.5, 1.6)
    g.fill()
  }
  g.strokeStyle = l.body
  g.lineWidth = 3.8
  g.beginPath()
  g.moveTo(5, -23)
  g.lineTo(hx, hy)
  g.stroke()
  g.restore()
}
