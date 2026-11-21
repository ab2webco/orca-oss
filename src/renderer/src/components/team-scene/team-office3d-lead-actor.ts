import type * as THREE from 'three'
import type { Office3dSeatView } from '../../../../shared/team-scene/team-office3d-actions'
import { office3dCabFloorAt } from '../../../../shared/team-scene/team-office3d-elevator'
import {
  OFFICE3D_CALL,
  OFFICE3D_DOOR_Z,
  OFFICE3D_LIFT,
  OFFICE3D_PITCH,
  type Office3dLayout
} from '../../../../shared/team-scene/team-office3d-layout'
import {
  office3dLeadRoundOf,
  office3dWalkerAt
} from '../../../../shared/team-scene/team-office3d-walkers'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { dioramaLookOf, type DioramaFigure } from './team-diorama-figures'
import type { DioramaKit } from './team-diorama-kit'
import { poseDioramaFigure } from './team-diorama-poses'
import { OFFICE3D_LEAD_COAT, office3dDev } from './team-office3d-dev'
import type { Office3dPalette } from './team-office3d-floor'
import { office3dLeadMark, office3dLiftShaft } from './team-office3d-lift'
import { OFFICE3D_SIT_Y, poseOffice3dSeated } from './team-office3d-seated-poses'

/** The lead on its round, the cab it rides, and each floor's lift doors and call panel. */
export function office3dLeadActor(
  kit: DioramaKit,
  X: Office3dPalette,
  world: THREE.Object3D,
  args: {
    layout: Office3dLayout
    input: TeamSceneInput
    views: ReadonlyMap<string, Office3dSeatView>
    pace: string
    doors: readonly THREE.Mesh[][]
    calls: readonly ((on: boolean) => void)[]
  }
): { figure: DioramaFigure; tick: (t: number) => void } {
  // The lead and the one cab it rides; askers first, then a word with whoever is typing.
  const keys = (pose: Office3dSeatView['pose']) =>
    args.input.members.filter((m) => args.views.get(m.key)?.pose === pose).map((m) => m.key)
  const round = office3dLeadRoundOf({
    layout: args.layout,
    needs: keys('raise'),
    visits: keys('type'),
    pace: args.pace
  })
  const lead = office3dDev(
    dioramaLookOf(args.input.lead.characterKey ?? args.input.lead.key),
    'lead'
  )
  const leadScale = lead.g.scale.x
  world.add(lead.g)
  const { group: shaft, cab } = office3dLiftShaft(kit, X, args.layout.floors.length)
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
      poseOffice3dSeated(lead, 'type', t)
    } else {
      poseDioramaFigure(
        lead,
        at.pose === 'give' ? 'talk' : at.pose === 'call' ? 'idle' : at.pose,
        t
      )
      if (at.pose === 'call') {
        lead.arms[1]!.rotation.x = -1.3
      }
    }
    const tt = round.total > 0 ? t % round.total : 0
    const cabAt = office3dCabFloorAt(round.cab, tt)
    cab.position.y = cabAt * OFFICE3D_PITCH
    // The leaves slide open while the cab waits on a floor and the lead is at its door.
    const near = Math.hypot(at.at[0] - OFFICE3D_LIFT[0] / 2, at.at[1] - OFFICE3D_DOOR_Z)
    // The call lights while the lead waits at a floor's panel for a cab that is not there yet.
    const atCall = Math.hypot(at.at[0] - OFFICE3D_CALL[0], at.at[1] - OFFICE3D_CALL[1]) < 0.15
    for (const [fi, light] of args.calls.entries()) {
      const onFloor = Math.abs(at.floor - fi) < 0.05
      light(onFloor && (at.pose === 'call' || (atCall && Math.abs(cabAt - fi) > 0.05)))
    }
    for (const [fi, leaves] of args.doors.entries()) {
      // Why not while pressing: the doors answer the call, so they open only after it.
      const here =
        at.pose !== 'call' && Math.abs(cabAt - fi) < 0.05 && Math.abs(at.floor - fi) < 0.05
      const open = here ? Math.min(1, Math.max(0, (1.9 - near) / 0.6)) : 0
      for (const [side, leaf] of leaves.entries()) {
        leaf.position.z = OFFICE3D_DOOR_Z + (side ? 1 : -1) * (0.42 + open * 0.8)
      }
    }
    const p = lead.g.position
    leadMark.position.set(p.x, p.y + 2.5 + Math.sin(t * 2.4) * 0.06, p.z)
  }
  return { figure: lead, tick }
}
