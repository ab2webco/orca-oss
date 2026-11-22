import { teamSceneMemberLookOf } from '../../../../shared/team-scene/team-scene-member-looks'
import type * as THREE from 'three'
import type { DioramaPlotView } from '../../../../shared/team-scene/team-diorama-actions'
import { dioramaActivitySpotsOf } from '../../../../shared/team-scene/team-diorama-activities'
import type { DioramaCue } from '../../../../shared/team-scene/team-diorama-cues'
import {
  DIORAMA_GATE,
  type DioramaLayout,
  type DioramaPoint
} from '../../../../shared/team-scene/team-diorama-layout'
import { dioramaStandOf } from '../../../../shared/team-scene/team-diorama-lead-round'
import {
  dioramaWalkGrid,
  polyAt,
  polyLengths,
  type DioramaGrid
} from '../../../../shared/team-scene/team-diorama-nav'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { dioramaPoof } from './team-diorama-cue-meshes'
import { dioramaFigure, type DioramaFigure } from './team-diorama-figures'
import type { DioramaKit } from './team-diorama-kit'
import { POSE_OF_ACTION, poseDioramaFigure, type DioramaPose } from './team-diorama-poses'
import { dioramaActivity, type DioramaTick } from './team-diorama-props'
import type { DioramaWorld } from './team-diorama-world-meshes'
const ARRIVE_WALK = 1.6
const ARRIVE_AFTER_POOF = 0.45

/** A walk that starts at `start` along `pts`; before it the walker is not there yet. */
function arrival(
  f: DioramaFigure,
  pts: DioramaPoint[],
  start: number,
  settle: (t: number) => DioramaPose
) {
  const cum = polyLengths(pts)
  const total = cum.at(-1)!
  const rest = { x: f.g.position.x, z: f.g.position.z, yaw: f.g.rotation.y }
  return (t: number): DioramaPose => {
    const d = (t - start) * ARRIVE_WALK
    f.g.visible = d >= 0
    if (d < 0 || d >= total) {
      f.g.position.set(rest.x, f.g.position.y, rest.z)
      f.g.rotation.y = rest.yaw
      return settle(t)
    }
    const at = polyAt(pts, cum, d)
    f.g.position.set(at.at[0], f.g.position.y, at.at[1])
    f.g.rotation.y = Math.atan2(at.heading[0], at.heading[1])
    return 'walk'
  }
}

/**
 * Every member at its plot or its free-time spot, posed by its action. A member that just joined
 * appears in a dust puff at the keep's gate and walks to its plot; on another machine it appears
 * at its plot.
 */
export function dioramaCast(
  k: DioramaKit,
  world: THREE.Object3D,
  args: {
    layout: DioramaLayout
    views: ReadonlyMap<string, DioramaPlotView>
    input: TeamSceneInput
    cues: readonly DioramaCue[]
    lite: boolean
    stands: DioramaWorld['stands']
  }
): { ticks: DioramaTick[]; figures: Map<string, DioramaFigure> } {
  const { layout, views, input, stands } = args
  const ticks: DioramaTick[] = []
  const figures = new Map<string, DioramaFigure>()
  const arriving = new Map(
    args.cues.filter((c) => c.kind === 'arrive').map((c) => [c.key, c.start] as const)
  )
  let walk: DioramaGrid | null = null
  const spots = new Map(dioramaActivitySpotsOf(layout, views).map((spot) => [spot.key, spot]))
  for (const island of layout.islands) {
    // Why the overflow: a free or resting member with no plot still fishes or sits by the fire.
    const plotless = island.home ? layout.overflow.filter((key) => spots.has(key)) : []
    const extra = plotless.map((key) => ({ x: 0, z: 0, key, taken: false }))
    for (const plot of [...island.plots, ...extra]) {
      const view = plot.key ? views.get(plot.key) : undefined
      const member = input.members.find((m) => m.key === plot.key)
      if (!view || !member || view.action === 'gone' || view.action === 'start') {
        continue
      }
      const f = dioramaFigure(
        k,
        teamSceneMemberLookOf({
          role: 'member',
          key: member.key,
          characterKey: member.characterKey
        }),
        {
          lite: args.lite
        }
      )
      world.add(f.g)
      figures.set(member.key, f)
      const spot = spots.get(member.key)
      let poseAt: (t: number) => DioramaPose
      if (spot) {
        // A free or resting member leaves its plot for its spot; the plot keeps its build.
        f.g.position.set(spot.at[0], 0, spot.at[1])
        f.g.rotation.y = Math.atan2(spot.face[0] - spot.at[0], spot.face[1] - spot.at[1])
        poseAt = dioramaActivity(k, spot, f, world, figures.size)
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
      } else {
        const placed = stands.get(member.key)
        const [x, z] = placed?.at ?? dioramaStandOf(plot)
        f.g.position.set(x, 0, z)
        const face = placed?.stand.face ?? [plot.x - x, plot.z - z]
        f.g.rotation.y = Math.atan2(face[0], face[1])
        const pose = placed?.stand.pose ?? POSE_OF_ACTION[view.action]
        poseAt = () => pose
      }
      const start = arriving.get(member.key)
      if (start === undefined) {
        ticks.push((t) => poseDioramaFigure(f, poseAt(t), t))
        continue
      }
      const home = island.home && !spot?.loop
      const from: DioramaPoint = home ? DIORAMA_GATE : [f.g.position.x, f.g.position.z]
      ticks.push(dioramaPoof(world, from, start))
      walk ??= dioramaWalkGrid(layout)
      const pts = home ? walk.path(from, [f.g.position.x, f.g.position.z]) : []
      if (pts.length < 2) {
        ticks.push((t) => {
          f.g.visible = t >= start + ARRIVE_AFTER_POOF
          poseDioramaFigure(f, poseAt(t), t)
        })
        continue
      }
      const step = arrival(f, pts, start + ARRIVE_AFTER_POOF, poseAt)
      ticks.push((t) => poseDioramaFigure(f, step(t), t))
    }
  }
  return { ticks, figures }
}
