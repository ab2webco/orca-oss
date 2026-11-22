import { FIGURES_LEAD_LOOK } from '../../../../shared/team-scene/team-scene-member-looks'
import type * as THREE from 'three'
import type { DioramaPlotView } from '../../../../shared/team-scene/team-diorama-actions'
import type { DioramaLayout, DioramaPoint } from '../../../../shared/team-scene/team-diorama-layout'
import {
  type DioramaPace,
  dioramaBoatAt,
  dioramaLeadAt,
  dioramaLeadRoundOf
} from '../../../../shared/team-scene/team-diorama-lead-round'
import { dioramaWaterGrid } from '../../../../shared/team-scene/team-diorama-nav'
import { dioramaRoadNet } from '../../../../shared/team-scene/team-diorama-roads'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { DIORAMA_BOAT_SEAT, dioramaBoat } from './team-diorama-boats'
import { dioramaFigure, type DioramaFigure } from './team-diorama-figures'
import type { DioramaKit } from './team-diorama-kit'
import { dioramaMage } from './team-diorama-mage'
import { poseDioramaFigure } from './team-diorama-poses'

const VISITABLE = new Set(['build', 'inspect', 'wait', 'repair', 'cheer'])

/** The lead on its round: needs-you first, then each island by boat; only roads and water. */
export function dioramaLeadActor(
  k: DioramaKit,
  world: THREE.Object3D,
  args: {
    layout: DioramaLayout
    views: ReadonlyMap<string, DioramaPlotView>
    input: TeamSceneInput
    lite: boolean
    pace: DioramaPace
    /** Where each member stands on its plot, so the lead talks to it there. */
    stands?: ReadonlyMap<string, DioramaPoint>
  }
): { figure: DioramaFigure; tick: (t: number) => void } {
  const { layout, views, input } = args
  const lead = dioramaFigure(k, FIGURES_LEAD_LOOK, { lead: true, lite: args.lite })
  world.add(lead.g)
  const leadScale = lead.g.scale.x
  const round = dioramaLeadRoundOf({
    layout,
    roads: dioramaRoadNet(layout),
    water: dioramaWaterGrid(layout),
    needs: input.members.filter((m) => views.get(m.key)?.action === 'signal').map((m) => m.key),
    visits: input.members
      .filter((m) => VISITABLE.has(views.get(m.key)?.action ?? ''))
      .map((m) => m.key),
    pace: args.pace,
    stands: args.stands
  })
  const boats = Object.entries(layout.homeDocks).map(([column, dock]) => ({
    column: Number(column),
    home: dock.boat,
    boat: dioramaBoat(k, world)
  }))
  const mage = args.pace === 'direct' ? dioramaMage(k, world, round, args.lite) : null
  let yaw = 0
  let lastT: number | null = null
  const tick = (t: number) => {
    mage?.(t)
    for (const b of boats) {
      const at = dioramaBoatAt(round, b.column, b.home, t)
      b.boat.place(at.at, at.heading, t, at.moving)
    }
    const at = dioramaLeadAt(round, t)
    lead.g.position.x = at.at[0]
    lead.g.position.z = at.at[1]
    lead.baseY = at.pose === 'sit' ? DIORAMA_BOAT_SEAT : 0
    lead.g.scale.setScalar(leadScale * at.blink)
    // Why eased: a snapped turn reads as a jump; it turns toward its heading over a few frames.
    if (at.heading && Math.hypot(at.heading[0], at.heading[1]) > 1e-6) {
      const goal = Math.atan2(at.heading[0], at.heading[1])
      const dt = lastT === null ? 1 : Math.min(0.1, Math.max(0, t - lastT))
      yaw += (((goal - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 7)
      lead.g.rotation.y = yaw
    }
    lastT = t
    poseDioramaFigure(lead, at.pose === 'talk' ? 'talk' : at.pose, t)
  }
  return { figure: lead, tick }
}
