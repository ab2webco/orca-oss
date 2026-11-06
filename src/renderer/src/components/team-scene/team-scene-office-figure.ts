import type { TeamSceneActor, TeamScenePose } from '../../../../shared/team-scene/team-scene-types'
import { footOffsetOf } from './team-scene-figure-draw'
import { figureLookOf, figureSeedOf } from './team-scene-figure-looks'

/** Office people are drawn this much larger than Figures; their stride shrinks to match. */
export const OFFICE_FIGURE_SCALE = 1.22
const BONE = 10.3
const HIP_LIFT = 9
const TAU = 2 * Math.PI
const CROWN = '#f2c94c'
const HAIRS = ['#4a2f1e', '#1f1a1a', '#a85a2a', '#17120f', '#c9b8a0', '#2a1a12', '#6d6a68'] as const

export type OfficeLook = {
  shirt: string
  leg: string
  skin: string
  hair: string
  long: boolean
  crowned: boolean
}

/** Same seed as Figures, so a member's shirt and skin carry across styles. */
export function officeLookOf(
  actor: Pick<TeamSceneActor, 'role' | 'key' | 'characterKey'>
): OfficeLook {
  const figure = figureLookOf(actor)
  const seed = figureSeedOf(actor.characterKey ?? actor.key)
  return {
    shirt: actor.role === 'lead' ? '#2b3a55' : figure.body,
    leg: figure.leg,
    skin: figure.skin,
    hair: HAIRS[(seed >>> 16) % HAIRS.length]!,
    long: ((seed >>> 20) & 1) === 1,
    crowned: actor.role === 'lead'
  }
}

function armAngle(
  pose: TeamScenePose,
  t: number,
  gait: number,
  seated: boolean,
  carrying: boolean
): number {
  if (pose === 'raise' || pose === 'wave' || pose === 'cheer') {
    return 2.75 + Math.sin(t * 9) * 0.16
  }
  if (pose === 'give') {
    return 1.45
  }
  if (carrying) {
    return 1.05
  }
  if (pose === 'work' && seated) {
    return 1.4 + Math.sin(t * 14) * 0.07
  }
  return pose === 'walk' ? Math.cos(gait) * 0.6 : 0.3 + Math.sin(t * 2) * 0.04
}

function drawLegs(
  g: CanvasRenderingContext2D,
  l: OfficeLook,
  walking: boolean,
  gait: number,
  bob: number
): void {
  for (const side of [-1, 1] as const) {
    const step = footOffsetOf(gait + (side > 0 ? Math.PI : 0))
    const foot = walking ? { x: step.x / OFFICE_FIGURE_SCALE, y: step.y } : { x: side * 1.2, y: 0 }
    const hx = side * 0.7
    const hy = -11 - HIP_LIFT - bob
    const fx = foot.x + (walking ? side * 0.5 : 0)
    const dx = fx - hx
    const dy = foot.y - hy
    const n = Math.hypot(dx, dy) || 1
    const reach = Math.min(n, BONE * 2 - 0.01)
    const bend = Math.sqrt(Math.max(0, BONE * BONE - (reach * reach) / 4))
    g.strokeStyle = l.leg
    g.lineWidth = 3.6
    g.beginPath()
    g.moveTo(hx, hy)
    g.lineTo(hx + dx / 2 + (bend * dy) / n, hy + dy / 2 - (bend * dx) / n)
    g.lineTo(fx, foot.y - 1)
    g.stroke()
    g.fillStyle = '#2a221c'
    g.beginPath()
    g.roundRect(fx - 3, foot.y - 2.8, 8.8, 2.9, 1.4)
    g.fill()
  }
}

/** An adult in side profile facing right, feet at the origin; seated, the origin is the chair. */
export function drawOfficeFigure(
  g: CanvasRenderingContext2D,
  l: OfficeLook,
  p: { t: number; pose: TeamScenePose; gait: number; carrying: boolean; seated: boolean }
): void {
  const walking = p.pose === 'walk'
  const bob = walking ? Math.abs(Math.sin(p.gait)) * 1.1 : Math.sin(p.t * 2.2) * 0.4
  const lift = p.seated ? 0 : HIP_LIFT
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (p.seated) {
    g.strokeStyle = l.leg
    g.lineWidth = 4
    g.beginPath()
    g.moveTo(0, -11)
    g.lineTo(10, -12)
    g.lineTo(10, -1)
    g.stroke()
  } else {
    drawLegs(g, l, walking, p.gait, bob)
  }
  g.save()
  g.translate(0, -bob - lift)
  g.rotate(walking ? 0.05 : 0)
  g.fillStyle = l.shirt
  g.beginPath()
  g.roundRect(-5, -28, 10, 20, 4.5)
  g.fill()
  g.fillStyle = '#eef1f5'
  g.beginPath()
  g.moveTo(0.8, -28)
  g.lineTo(3.6, -23.5)
  g.lineTo(5, -27)
  g.fill()
  g.save()
  g.translate(0, -28)
  g.scale(0.74, 0.74)
  g.translate(0, 28)
  if (l.long) {
    g.fillStyle = l.hair
    g.beginPath()
    g.roundRect(-10, -36, 7, 17, 3)
    g.fill()
  }
  g.fillStyle = l.skin
  g.beginPath()
  g.arc(0, -33, 8.4, 0, TAU)
  g.fill()
  g.fillStyle = l.hair
  g.beginPath()
  g.arc(0, -33.5, 8.9, Math.PI * 0.98, Math.PI * 1.98)
  g.lineTo(-3, -36.5)
  g.closePath()
  g.fill()
  g.fillStyle = '#1d1a22'
  g.beginPath()
  g.ellipse(4.6, -33.6, 1.15, 1.7, 0, 0, TAU)
  g.fill()
  if (l.crowned) {
    g.fillStyle = CROWN
    g.beginPath()
    for (const [x, y] of [
      [-6, -43],
      [-7, -51],
      [-3, -47],
      [0, -53],
      [3, -47],
      [7, -51],
      [6, -43]
    ] as const) {
      g.lineTo(x, y)
    }
    g.closePath()
    g.fill()
  }
  g.restore()
  const a = armAngle(p.pose, p.t, p.gait, p.seated, p.carrying)
  const hx = 0.5 + Math.sin(a) * 9
  const hy = -23 + Math.cos(a) * 9
  if (p.carrying) {
    g.fillStyle = '#f4e6c0'
    g.fillRect(hx - 1, hy - 5, 9, 6.5)
  }
  g.strokeStyle = l.shirt
  g.lineWidth = 3.8
  g.beginPath()
  g.moveTo(0.5, -23)
  g.lineTo(hx, hy)
  g.stroke()
  g.restore()
}
