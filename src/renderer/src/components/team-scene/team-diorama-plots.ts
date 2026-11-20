import type * as THREE from 'three'
import type {
  DioramaAction,
  DioramaPlotView
} from '../../../../shared/team-scene/team-diorama-actions'
import type { DioramaPlot } from '../../../../shared/team-scene/team-diorama-layout'
import {
  dioramaFlag,
  dioramaHouse,
  dioramaScaffold,
  type DioramaTick
} from './team-diorama-buildings'
import { dioramaPlankPile } from './team-diorama-camp'
import { dioramaConfetti, dioramaFire, dioramaSignal, dioramaSmoke } from './team-diorama-fx'
import type { DioramaKit } from './team-diorama-kit'
import type { DioramaPose } from './team-diorama-poses'

// Why a port: each state shows on its plot as the approved prototype's drawPlot draws it (frame
// and planks, lit scaffold, flag, signal, fire and smoke, trophy and confetti; ORCA-1296).

/** Where its member stands on the plot, which way it faces, and what it plays there. */
export type DioramaPlotStand = { dx: number; dz: number; face: [number, number]; pose: DioramaPose }

const STAND: Partial<Record<DioramaAction, DioramaPlotStand>> = {
  build: { dx: 1.55, dz: 1.2, face: [-1, -0.6], pose: 'hammer' },
  inspect: { dx: 0.7, dz: 1.75, face: [0.2, 1], pose: 'idle' },
  wait: { dx: -0.4, dz: 1.6, face: [0.7, 1], pose: 'idle' },
  signal: { dx: 1.6, dz: 1.25, face: [0.25, 1], pose: 'wave' },
  repair: { dx: -1.45, dz: 1.15, face: [1, -0.6], pose: 'hammer' },
  cheer: { dx: -0.6, dz: 1.6, face: [0.8, 1], pose: 'cheer' }
}
const IDLE_STAND: DioramaPlotStand = { dx: 0, dz: 1.75, face: [1, 1], pose: 'idle' }
/** The prototype's stage per state; a build shows its real progress, at least its frame. */
const STAGE: Partial<Record<DioramaAction, number>> = {
  inspect: 3,
  wait: 4,
  signal: 2,
  repair: 4,
  cheer: 4
}

/** A free plot: cleared, with a sign, waiting for the next member. A seat held elsewhere is dim. */
function freePlot(k: DioramaKit, plot: DioramaPlot, parent: THREE.Object3D) {
  const pad = k.mat(k.p.pad, plot.taken ? { opacity: 0.5 } : {})
  k.mesh(k.box(2.7, 0.05, 2.7), pad, plot.x, 0.025, plot.z, parent, false)
  if (!plot.taken) {
    k.mesh(k.box(0.07, 0.6, 0.07), k.mat(k.p.woodDark), plot.x + 0.9, 0.3, plot.z + 0.9, parent)
    k.mesh(k.box(0.5, 0.3, 0.05), k.mat(k.p.canvas), plot.x + 0.9, 0.62, plot.z + 0.92, parent)
  }
}

/** A member starting: its plot staked out with rope, before it walks in. */
function stakedPlot(k: DioramaKit, x: number, z: number, parent: THREE.Object3D) {
  k.mesh(k.box(2.7, 0.05, 2.7), k.mat(k.p.pad), x, 0.025, z, parent, false)
  const C = [
    [-1.15, -1.15],
    [1.15, -1.15],
    [1.15, 1.15],
    [-1.15, 1.15]
  ] as const
  C.forEach(([dx, dz], n) => {
    k.mesh(k.box(0.08, 0.55, 0.08), k.mat(k.p.wood), x + dx, 0.27, z + dz, parent)
    k.mesh(k.box(0.1, 0.08, 0.1), k.mat(0xf2f2f2), x + dx, 0.5, z + dz, parent)
    const [ex, ez] = C[(n + 1) % 4]!
    const rope = k.mesh(
      k.box(0.025, 0.025, 2.3),
      k.mat(0xf7f5ef),
      x + (dx + ex) / 2,
      0.42,
      z + (dz + ez) / 2,
      parent,
      false
    )
    rope.rotation.y = Math.atan2(ex - dx, ez - dz)
  })
}

/**
 * Draws a plot by its member's state and returns where that member stands, or null for an empty
 * plot. `live` is false on a machine that cannot be reached: its builds stay, nothing animates.
 */
export function dioramaPlot(
  k: DioramaKit,
  plot: DioramaPlot,
  view: DioramaPlotView | undefined,
  parent: THREE.Object3D,
  live: boolean,
  ticks: DioramaTick[]
): DioramaPlotStand | null {
  const { x, z } = plot
  if (!view) {
    freePlot(k, plot, parent)
    return null
  }
  const action = view.action
  if (action === 'start') {
    stakedPlot(k, x, z, parent)
    return STAND.build!
  }
  const stage = STAGE[action] ?? Math.max(action === 'build' ? 2 : 1, view.stage)
  const house = dioramaHouse(k, x, z, stage, parent, {
    roof: action === 'cheer' ? k.p.roof2 : undefined
  })
  house.userData.plot = plot.key
  if (action === 'build') {
    dioramaPlankPile(k, parent, x + 1.9, z - 0.9)
  } else if (action === 'inspect' && live) {
    ticks.push(dioramaScaffold(k, parent, x, z, k.status.working))
  } else if (action === 'wait') {
    ticks.push(dioramaFlag(k, parent, x + 1.35, z + 1.25, k.p.banner, 2.4, 0.8))
  } else if (action === 'repair') {
    ticks.push(
      dioramaFire(k, parent, x - 0.2, 2, z + 0.2, k.status.attention, 1.35),
      dioramaFire(k, parent, x + 0.5, 1.8, z - 0.3, k.status.attention, 0.9),
      dioramaSmoke(k, parent, x, 2.6, z)
    )
  } else if (action === 'cheer') {
    ticks.push(dioramaFlag(k, parent, x + 1.35, z + 1.25, k.status.done, 1.6, 0.5))
    if (live) {
      ticks.push(dioramaConfetti(k, parent, x, z))
    }
  }
  const stand = STAND[action] ?? IDLE_STAND
  if (action === 'signal') {
    const [sx, sz] = [x + stand.dx, z + stand.dz]
    const sig = dioramaSignal(k)
    sig.userData.signal = plot.key
    parent.add(sig)
    k.glow(parent, sx, 3.2, sz, k.status.attention, 1.6, k.p.lit ? 0.7 : 0.35)
    ticks.push((t) => {
      const s = 1 + Math.sin(t * 2.6) * 0.06
      sig.scale.set(0.62 * s * 1.3, 0.78 * s * 1.3, 1)
      sig.position.set(sx, 3.35 + Math.sin(t * 1.6) * 0.06, sz)
    })
  }
  return stand
}
