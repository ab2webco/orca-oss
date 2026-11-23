import type * as THREE from 'three'
import { office3dCabFloorAt } from '../../../../shared/team-scene/team-office3d-elevator'
import {
  OFFICE3D_DOOR_Z,
  OFFICE3D_PITCH,
  type Office3dLayout
} from '../../../../shared/team-scene/team-office3d-layout'
import {
  office3dLeadRoundOf,
  type Office3dRound,
  office3dWalkerAt
} from '../../../../shared/team-scene/team-office3d-walkers'
import type { Office3dMember } from '../../../../shared/team-scene/team-office3d-members'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import type { DioramaFigure } from './team-diorama-figures'
import type { DioramaKit } from './team-diorama-kit'
import { poseDioramaFigure } from './team-diorama-poses'
import { OFFICE3D_LEAD_COAT, office3dDev } from './team-office3d-dev'
import type { Office3dPalette } from './team-office3d-floor'
import { office3dAcrossFloors } from './team-office3d-floor-passes'
import { office3dLeadMark, office3dLiftShaft } from './team-office3d-lift'
import { office3dLiftAt } from './team-office3d-lift-doors'
import { OFFICE3D_SIT_Y, poseOffice3dSeated } from './team-office3d-seated-poses'

/** Where open lift door leaves rest: inside the side wall, which ends at the doorway. */
const POCKET_Z = 2.8

/** The lead on its round, the cab it rides, and each floor's lift doors and call panel. */
export function office3dLeadActor(
  kit: DioramaKit,
  X: Office3dPalette,
  world: THREE.Object3D,
  args: {
    layout: Office3dLayout
    input: TeamSceneInput
    /** The lead's trips from the building's traffic; absent, it sits at its desk. */
    plan: Office3dRound | null
    pace: string
    doors: readonly THREE.Mesh[][]
    calls: readonly ((on: boolean) => void)[]
    /** The members on their trips: the doors and call panels answer them too. */
    members?: ReadonlyMap<string, Office3dMember>
  }
): { figure: DioramaFigure; tick: (t: number) => void } {
  // Why only from the traffic: the lead moves for events, and with none it sits (ORCA-1317).
  const round = args.plan ?? {
    ...office3dLeadRoundOf({ layout: args.layout, needs: [], visits: [], pace: args.pace }),
    total: Infinity
  }
  // Needing the person is the one signal that asks them for something: a raised hand.
  const asks = args.input.lead.activity === 'needsYou'
  const lead = office3dDev(args.input.lead.characterKey ?? args.input.lead.key, 'lead')
  const leadScale = lead.g.scale.x
  world.add(lead.g)
  const { group: shaft, cab } = office3dLiftShaft(kit, X, args.layout.floors.length)
  office3dAcrossFloors(shaft)
  world.add(shaft)
  const leadMark = office3dLeadMark(OFFICE3D_LEAD_COAT)
  world.add(leadMark)
  const tick = (t: number) => {
    const at = office3dWalkerAt(round, t)
    lead.g.position.set(at.at[0], 0, at.at[1])
    // Why baseY: the diorama's poses set the figure's height from it on every frame.
    lead.baseY = at.floor * OFFICE3D_PITCH + (at.pose === 'desk' ? OFFICE3D_SIT_Y : 0)
    lead.g.scale.setScalar(leadScale * at.blink)
    if (at.heading && Math.hypot(at.heading[0], at.heading[1]) > 1e-6) {
      lead.g.rotation.y = Math.atan2(at.heading[0], at.heading[1])
    }
    lead.g.userData.seated = at.pose === 'desk' ? 'lead' : undefined
    if (at.pose === 'desk') {
      lead.g.rotation.y = 0
      poseOffice3dSeated(lead, asks ? 'raise' : 'type', t)
    } else {
      poseDioramaFigure(
        lead,
        at.pose === 'walk' || at.pose === 'talk' ? at.pose : at.pose === 'give' ? 'talk' : 'idle',
        t
      )
      if (at.pose === 'call') {
        lead.arms[1]!.rotation.x = -1.3
      }
    }
    const cabAt = office3dCabFloorAt(round.cab, t)
    cab.position.y = cabAt * OFFICE3D_PITCH
    const others = [...(args.members?.values() ?? [])].map((m) => office3dWalkerAt(m.plan, t))
    const lift = office3dLiftAt([at, ...others], round.cab, t, args.layout.floors.length)
    for (const [fi, light] of args.calls.entries()) {
      light(lift.lit[fi] ?? false)
    }
    for (const [fi, leaves] of args.doors.entries()) {
      const open = lift.open[fi] ?? 0
      for (const [side, leaf] of leaves.entries()) {
        // Why both into the wall: a leaf sliding toward the front stood outside the building.
        const shut = OFFICE3D_DOOR_Z + (side ? 0.42 : -0.42)
        leaf.position.z = shut - open * (shut - POCKET_Z)
      }
    }
    const p = lead.g.position
    leadMark.position.set(p.x, p.y + 2.5 + Math.sin(t * 2.4) * 0.06, p.z)
  }
  return { figure: lead, tick }
}
