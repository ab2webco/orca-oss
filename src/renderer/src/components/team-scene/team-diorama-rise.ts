import type * as THREE from 'three'
import { dioramaCuePhase, type DioramaCue } from '../../../../shared/team-scene/team-diorama-cues'
import type { DioramaTick } from './team-diorama-props'

// Why it rises: connecting a machine reads as its island coming up out of the sea, then its dock
// being built, before its members step out (owner, ORCA-1296).

const DEPTH = 3.4
const UP = 0.6

const ease = (x: number) => {
  const k = Math.max(0, Math.min(1, x))
  return k * k * (3 - 2 * k)
}

/** Raises each island a `rise` cue names out of the sea, then grows its dock up from the water. */
export function dioramaRises(world: THREE.Object3D, cues: readonly DioramaCue[]): DioramaTick[] {
  const ticks: DioramaTick[] = []
  for (const c of cues) {
    if (c.kind !== 'rise') {
      continue
    }
    const island = world.children.find((o) => o.userData.island === c.key)
    if (!island) {
      continue
    }
    const docks = island.children.filter((o) => o.userData.dock)
    ticks.push((t) => {
      const ph = dioramaCuePhase(c, t)
      const k = ph < 0 ? 0 : ph >= 1 ? 1 : ease(ph / UP)
      island.position.y = -DEPTH * (1 - k)
      const built = ph < 0 ? 0 : ph >= 1 ? 1 : ease((ph - UP) / (1 - UP - 0.1))
      for (const d of docks) {
        d.visible = built > 0
        d.scale.y = Math.max(0.01, built)
      }
    })
  }
  return ticks
}
