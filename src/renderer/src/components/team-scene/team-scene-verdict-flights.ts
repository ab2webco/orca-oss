import type {
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneVerdictTone
} from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneFrame } from './team-scene-painter'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'

/** How long Jev's decision takes to reach a desk: inside the second the owner asked for. */
export const VERDICT_FLIGHT_SECONDS = 0.7
// Why a cap and a stagger: one poll can bring several decisions; a few tokens in turn read, more is noise.
const MAX_FLIGHTS = 3
const STAGGER = 0.2
const LANDED_SECONDS = 1.2
const RING = 0.35
const ARC_PX = 26
// Above the floor: about a sitter's head, under its monitor.
const AIM_PX = 30
const TOKEN_PX = 4
const TAU = 2 * Math.PI
const INK = '#ffffff'

type Flight = {
  to: string
  tone: TeamSceneVerdictTone
  from: { x: number; depth: number }
  p: number
}

/** A decision's colour from the card's status palette. */
export const verdictColorOf = (tone: TeamSceneVerdictTone, colors: TeamSceneStatusColors): string =>
  ({ allow: colors.done, ask: colors.risk, deny: colors.attention, note: colors.working })[tone]

/** A landed decision on its member's monitor, 0 to 1 over its moment. */
export type TeamSceneLandedVerdict = { tone: TeamSceneVerdictTone; color: string; p: number }

/**
 * Jev's decisions as tokens from the advisor to each judged member, a ring where each lands, and
 * that member's monitor moment after. A second decision for a member still in flight recolours its
 * token rather than sending another (ORCA-1218).
 */
export function createVerdictFlights(
  feetY: (depth: number, h: number) => number,
  colors: TeamSceneStatusColors
) {
  let flights: Flight[] = []
  const landed = new Map<string, { tone: TeamSceneVerdictTone; at: number }>()
  return {
    start: (effects: readonly TeamSceneEffect[], actors: readonly TeamSceneActor[]): void => {
      const advisor = actors.find((a) => a.role === 'advisor')
      for (const e of effects) {
        if (e.kind !== 'verdict' || !advisor) {
          continue
        }
        const flying = flights.filter((one) => one.p < 1)
        const same = flying.find((one) => one.to === e.to)
        if (same) {
          same.tone = e.tone
        } else if (flying.length < MAX_FLIGHTS) {
          const delay = flying.filter((one) => one.p < STAGGER).length * STAGGER
          flights.push({
            to: e.to,
            tone: e.tone,
            from: { x: advisor.x, depth: advisor.depth },
            p: -delay
          })
        }
      }
    },
    draw: (g: CanvasRenderingContext2D, f: TeamSceneFrame): void => {
      const { width: w, height: h } = f
      flights = flights.filter((one) => {
        const to = f.actors.find((a) => a.key === one.to)
        const was = one.p
        one.p += f.dt / VERDICT_FLIGHT_SECONDS
        if (!to || one.p >= 1 + RING) {
          return false
        }
        if (was < 1 && one.p >= 1) {
          landed.set(one.to, { tone: one.tone, at: f.t })
        }
        if (one.p < 0) {
          return true
        }
        const color = verdictColorOf(one.tone, colors)
        const toY = feetY(to.depth, h) - AIM_PX
        if (one.p >= 1) {
          const q = (one.p - 1) / RING
          g.save()
          g.globalAlpha = 1 - q
          g.strokeStyle = color
          g.lineWidth = 2
          g.beginPath()
          g.arc(to.x * w, toY, TOKEN_PX + 9 * q, 0, TAU)
          g.stroke()
          g.restore()
          return true
        }
        const fromY = feetY(one.from.depth, h) - AIM_PX
        const x = (one.from.x + (to.x - one.from.x) * one.p) * w
        const y = fromY + (toY - fromY) * one.p - Math.sin(one.p * Math.PI) * ARC_PX
        g.save()
        g.fillStyle = INK
        g.beginPath()
        g.arc(x, y, TOKEN_PX + 1.2, 0, TAU)
        g.fill()
        g.fillStyle = color
        g.beginPath()
        g.arc(x, y, TOKEN_PX, 0, TAU)
        g.fill()
        g.restore()
        return true
      })
    },
    /** The decision that landed on `key`'s desk, while its moment lasts. */
    landedOn: (key: string | undefined, t: number): TeamSceneLandedVerdict | undefined => {
      const one = key === undefined ? undefined : landed.get(key)
      if (!one || t - one.at >= LANDED_SECONDS) {
        if (key !== undefined) {
          landed.delete(key)
        }
        return undefined
      }
      return {
        tone: one.tone,
        color: verdictColorOf(one.tone, colors),
        p: (t - one.at) / LANDED_SECONDS
      }
    },
    clear: (): void => {
      flights = []
      landed.clear()
    }
  }
}

type Rect = { x: number; y: number; width: number; height: number }

/** A monitor washing in the decision's colour with its mark: a tick, a cross or a bar. */
export function drawVerdictScreen(
  g: CanvasRenderingContext2D,
  r: Rect,
  v: TeamSceneLandedVerdict
): void {
  const [ux, uy] = [r.width / 28, r.height / 18]
  const rise = Math.sin(v.p * Math.PI)
  g.save()
  g.globalAlpha = rise * 0.55
  g.fillStyle = v.color
  g.fillRect(r.x, r.y, r.width, r.height)
  g.globalAlpha = Math.min(1, rise * 1.6)
  g.strokeStyle = INK
  g.lineWidth = Math.max(1.5, 2.2 * uy)
  g.lineCap = 'round'
  const path = (points: [number, number][]): void => {
    g.beginPath()
    points.forEach(([u, w], i) =>
      i === 0 ? g.moveTo(r.x + u * ux, r.y + w * uy) : g.lineTo(r.x + u * ux, r.y + w * uy)
    )
    g.stroke()
  }
  // In the upper screen, which the sitter's head leaves clear.
  if (v.tone === 'allow') {
    path([
      [8, 6.5],
      [12.5, 11],
      [20.5, 3]
    ])
  } else if (v.tone === 'deny') {
    path([
      [10, 3],
      [18, 11]
    ])
    path([
      [18, 3],
      [10, 11]
    ])
  } else if (v.tone === 'ask') {
    path([
      [14, 2.5],
      [14, 8]
    ])
    path([
      [14, 11],
      [14, 11.2]
    ])
  }
  g.restore()
}
