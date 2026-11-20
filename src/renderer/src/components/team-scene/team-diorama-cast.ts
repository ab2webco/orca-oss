import type * as THREE from 'three'
import type { DioramaPlotView } from '../../../../shared/team-scene/team-diorama-actions'
import { dioramaActivitySpotsOf } from '../../../../shared/team-scene/team-diorama-activities'
import type { DioramaLayout } from '../../../../shared/team-scene/team-diorama-layout'
import { dioramaStandOf } from '../../../../shared/team-scene/team-diorama-lead-round'
import { polyAt, polyLengths } from '../../../../shared/team-scene/team-diorama-nav'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { dioramaFigure, dioramaLookOf, type DioramaFigure } from './team-diorama-figures'
import type { DioramaKit } from './team-diorama-kit'
import { POSE_OF_ACTION, poseDioramaFigure, type DioramaPose } from './team-diorama-poses'
import { dioramaActivity, type DioramaTick } from './team-diorama-props'

const SPOT_POSE = { fish: 'fish', chop: 'chop', rest: 'sit', farm: 'water' } as const
/** Every member at its plot or its free-time spot, posed by its action. */
export function dioramaCast(
  k: DioramaKit,
  world: THREE.Object3D,
  args: {
    layout: DioramaLayout
    views: ReadonlyMap<string, DioramaPlotView>
    input: TeamSceneInput
    lite: boolean
  }
): { ticks: DioramaTick[]; figures: Map<string, DioramaFigure> } {
  const { layout, views, input } = args
  const ticks: DioramaTick[] = []
  const figures = new Map<string, DioramaFigure>()
  const spots = new Map(dioramaActivitySpotsOf(layout, views).map((spot) => [spot.key, spot]))
  for (const island of layout.islands) {
    for (const plot of island.plots) {
      const view = plot.key ? views.get(plot.key) : undefined
      const member = input.members.find((m) => m.key === plot.key)
      if (!view || !member || view.action === 'gone' || view.action === 'start') {
        continue
      }
      const f = dioramaFigure(k, dioramaLookOf(member.characterKey ?? member.key), {
        lite: args.lite
      })
      world.add(f.g)
      figures.set(member.key, f)
      const spot = spots.get(member.key)
      let pose: DioramaPose
      if (spot) {
        // A free or resting member leaves its plot for its spot; the plot keeps its build.
        f.g.position.set(spot.at[0], 0, spot.at[1])
        f.g.rotation.y = Math.atan2(spot.face[0] - spot.at[0], spot.face[1] - spot.at[1])
        const tick = dioramaActivity(k, spot, f, world)
        if (tick) {
          ticks.push(tick)
        }
        if (spot.loop) {
          const loop = [...spot.loop, spot.loop[0]!]
          const cum = polyLengths(loop)
          const phase = (spot.phase ?? 0) * cum.at(-1)!
          ticks.push((t) => {
            const at = polyAt(loop, cum, (t * 0.45 + phase) % cum.at(-1)!)
            f.g.position.set(at.at[0], f.g.position.y, at.at[1])
            f.g.rotation.y = Math.atan2(at.heading[0], at.heading[1])
          })
        }
        pose = SPOT_POSE[spot.kind]
      } else {
        const [x, z] = dioramaStandOf(plot)
        f.g.position.set(x, 0, z)
        f.g.rotation.y =
          Math.atan2(plot.x - x, plot.z - z) +
          (view.action === 'signal' || view.action === 'cheer' ? Math.PI : 0)
        pose = POSE_OF_ACTION[view.action]
      }
      ticks.push((t) => poseDioramaFigure(f, pose, t))
    }
  }
  return { ticks, figures }
}
