import * as THREE from 'three'
import type { Office3dSeatedPose } from './team-office3d-seated-poses'
import {
  OFFICE3D_PITCH,
  office3dLobbyOf,
  type Office3dLayout
} from '../../../../shared/team-scene/team-office3d-layout'
import {
  office3dMemberAt,
  type Office3dMember
} from '../../../../shared/team-scene/team-office3d-members'
import {
  office3dSlotId,
  type Office3dSlot
} from '../../../../shared/team-scene/team-office3d-slots'
import type { DioramaFigure } from './team-diorama-figures'
import type { Office3dTraffic } from '../../../../shared/team-scene/team-office3d-traffic'
import { office3dDev } from './team-office3d-dev'
import type { DioramaKit } from './team-diorama-kit'
import { poseDioramaFigure } from './team-diorama-poses'
import { OFFICE3D_SIT_Y, poseOffice3dSeated } from './team-office3d-seated-poses'

// Why every pose from the traffic: where a member is and what it does there come from its state
// only, so someone watching reads the team's work without reading anything (ORCA-1317).

/** Who has arrived in which slot this frame; a pair plays or talks together, one alone. */
export type Office3dRoomCount = Set<string>

/** The slot that pairs with `slot`: the other console seat, paddle or talk spot, or table chair. */
export function office3dPartnerOf(slot: Office3dSlot): string {
  const other = { ...slot, index: slot.index ^ 1 }
  return office3dSlotId(other).replace(/:[^:]*$/, '')
}
const pairKey = (s: Office3dSlot) => office3dSlotId(s).replace(/:[^:]*$/, '')

/** Whether `slot`'s partner has arrived this frame. */
export const office3dPaired = (slot: Office3dSlot, here: Office3dRoomCount): boolean =>
  here.has(office3dPartnerOf(slot))

/** The pairs' occupied slots this frame, by kind and index (positions differ by kind only). */
export function office3dRoomCountOf(
  members: Iterable<Office3dMember>,
  t: number
): Office3dRoomCount {
  const here = new Set<string>()
  for (const m of members) {
    const at = office3dMemberAt(m, t)
    if (at.slot && at.slot.kind !== 'desk') {
      here.add(pairKey(at.slot))
    }
  }
  return here
}

const yawOf = (from: [number, number], to: [number, number]) =>
  Math.atan2(to[0] - from[0], to[1] - from[1])

/**
 * Places and poses one member each frame from the traffic: at its desk with `desk`'s pose, seated
 * in a room, standing at a paddle or a talk spot, walking, waiting for the lift, or out of sight.
 */
export function office3dMover(args: {
  figure: DioramaFigure
  member: () => Office3dMember | undefined
  /** Its desk pose this frame (typing, a play while resting, a raised hand). */
  desk: (t: number) => Office3dSeatedPose
  deskScale: number
  here: (t: number) => Office3dRoomCount
  mark: THREE.Object3D | null
}): (t: number) => void {
  const { figure } = args
  const base = figure.g.scale.x
  return (t) => {
    const m = args.member()
    if (!m) {
      return
    }
    const at = office3dMemberAt(m, t)
    figure.g.visible = at.pose !== 'gone'
    if (args.mark) {
      args.mark.visible = figure.g.visible
    }
    if (!figure.g.visible) {
      return
    }
    const atDesk = at.pose === 'desk'
    figure.g.scale.setScalar(base * (atDesk ? args.deskScale : 1) * at.blink)
    figure.g.position.set(at.at[0], 0, at.at[1])
    figure.baseY = at.floor * OFFICE3D_PITCH
    figure.g.userData.seated = atDesk || at.pose === 'sit' ? 'member' : undefined
    if (at.heading && Math.hypot(at.heading[0], at.heading[1]) > 1e-6) {
      figure.g.rotation.y = Math.atan2(at.heading[0], at.heading[1])
    }
    const slot = at.slot
    if (slot && (at.pose === 'sit' || at.pose === 'stand' || atDesk)) {
      figure.g.rotation.y = atDesk ? Math.PI : yawOf(slot.at, slot.face)
    }
    const paired = slot ? office3dPaired(slot, args.here(t)) : false
    if (atDesk) {
      figure.baseY += OFFICE3D_SIT_Y * args.deskScale
      poseOffice3dSeated(figure, args.desk(t), t)
    } else if (at.pose === 'sit') {
      figure.baseY += OFFICE3D_SIT_Y
      // The console is played; the cafeteria talks when two share a table; a guest waits.
      poseOffice3dSeated(figure, slot?.kind === 'console' ? 'game' : 'idle', t)
      if (slot?.kind === 'cafe' && paired) {
        // Two at one table talk: a hand that gestures and a nod, turn and turn about.
        const turn = Math.sin(t * 1.2 + slot.index * Math.PI) > 0
        figure.arms[1]!.rotation.x = turn ? -0.7 + Math.sin(t * 4) * 0.25 : -0.3
        figure.head.rotation.x = turn ? 0 : Math.sin(t * 3) * 0.12
      }
    } else if (at.pose === 'stand' && slot?.kind === 'paddle') {
      poseDioramaFigure(figure, 'idle', t)
      // A rally swings the paddle arm; alone it holds the paddle and waits.
      figure.arms[1]!.rotation.x = paired
        ? -1.2 + Math.sin(t * 6 + slot.index * Math.PI) * 0.6
        : -0.6
    } else if (at.pose === 'stand') {
      poseDioramaFigure(figure, paired ? 'talk' : 'idle', t)
    } else {
      poseDioramaFigure(figure, at.pose === 'walk' ? 'walk' : 'idle', t)
      if (at.pose === 'call') {
        figure.arms[1]!.rotation.x = -1.3
      }
    }
    if (args.mark) {
      const p = figure.g.position
      args.mark.position.set(p.x, p.y + 2.3 * (atDesk ? args.deskScale : 1), p.z)
    }
  }
}

/** The table-tennis ball: it flies between the paddles while two play, and is put away alone. */
export function office3dRally(
  k: DioramaKit,
  world: THREE.Object3D,
  layout: Office3dLayout,
  here: (t: number) => Office3dRoomCount
): (t: number) => void {
  const L = office3dLobbyOf(layout.floors[0]?.width ?? 0)
  const ball = k.mesh(new THREE.SphereGeometry(0.06, 10, 8), k.mat(0xffffff), 0, 0, 0, world, false)
  const [a, b] = L.paddles.map((p) => p.at)
  return (t) => {
    const now = here(t)
    ball.visible = now.has('paddle:0:0') && now.has('paddle:0:1')
    if (!ball.visible || !a || !b) {
      return
    }
    const k01 = (Math.sin(t * 3) + 1) / 2
    ball.position.set(a[0] + (b[0] - a[0]) * k01, 1 + Math.abs(Math.cos(t * 3)) * 0.35, a[1])
  }
}

/** Who is where in the rooms, counted once per frame, so pairs play and talk together. */
export function office3dRoomCounter(traffic: Office3dTraffic | undefined) {
  let at = Number.NaN
  let now: Office3dRoomCount = new Set()
  return (t: number): Office3dRoomCount => {
    if (t !== at && traffic) {
      at = t
      now = office3dRoomCountOf(traffic.members.values(), t)
    }
    return now
  }
}

/** Members still walking out of the building after their card is gone: drawn until they leave. */
export function office3dLeavers(
  world: THREE.Object3D,
  traffic: Office3dTraffic,
  drawn: ReadonlySet<string>,
  here: (t: number) => Office3dRoomCount
): ((t: number) => void)[] {
  const ticks: ((t: number) => void)[] = []
  for (const [key, member] of traffic.members) {
    if (drawn.has(key) || !member.leaving) {
      continue
    }
    const figure = office3dDev(member.look ?? key, 'dev')
    world.add(figure.g)
    ticks.push(
      office3dMover({
        figure,
        member: () => traffic.members.get(key),
        desk: () => 'idle',
        deskScale: 1,
        here,
        mark: null
      })
    )
  }
  return ticks
}
