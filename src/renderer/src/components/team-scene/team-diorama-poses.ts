import type { DioramaAction } from '../../../../shared/team-scene/team-diorama-actions'
import type { DioramaFigure } from './team-diorama-figures'

// Why eased swings and no hops: the owner asked for smooth motion, nothing jumping or going back
// and forth (ORCA-1296).

export type DioramaPose =
  | 'idle'
  | 'walk'
  | 'hammer'
  | 'wave'
  | 'cheer'
  | 'sit'
  | 'talk'
  | 'chop'
  | 'fish'
  | 'water'

/** The loop a member plays at its plot for its action. */
export const POSE_OF_ACTION: Record<DioramaAction, DioramaPose> = {
  build: 'hammer',
  repair: 'hammer',
  inspect: 'idle',
  wait: 'idle',
  signal: 'wave',
  cheer: 'cheer',
  rest: 'sit',
  idle: 'idle',
  start: 'walk',
  gone: 'idle'
}

/** Poses `f` at time `t` (seconds); a still frame when `t` stays put, as under reduced motion. */
export function poseDioramaFigure(f: DioramaFigure, pose: DioramaPose, t: number): void {
  const [lL, lR] = f.legs
  const [aL, aR] = f.arms
  for (const part of [lL, lR, aL, aR]) {
    part!.rotation.set(0, 0, 0)
  }
  f.body.rotation.set(0, 0, 0)
  f.body.position.y = f.bodyY
  f.g.rotation.z = 0
  let lift = 0
  if (pose === 'walk') {
    const s = Math.sin(t * 6)
    lL!.rotation.x = s * 0.45
    lR!.rotation.x = -s * 0.45
    aL!.rotation.x = -s * 0.35
    aR!.rotation.x = s * 0.35
    lift = Math.abs(Math.cos(t * 6)) * 0.02
  } else if (pose === 'hammer') {
    aR!.rotation.x = -1.35 - Math.sin(t * 2.6) * 0.85
    aL!.rotation.x = -0.35
    f.body.rotation.y = Math.sin(t * 2.6) * 0.05
  } else if (pose === 'wave') {
    aL!.rotation.z = -0.35
    aR!.rotation.z = 2.55 + Math.sin(t * 3.2) * 0.28
  } else if (pose === 'cheer') {
    aL!.rotation.z = -2.55 - Math.sin(t * 1.8) * 0.18
    aR!.rotation.z = 2.55 - Math.sin(t * 1.8) * 0.18
    f.g.rotation.z = Math.sin(t * 1.8) * 0.04
  } else if (pose === 'chop') {
    const w = (Math.sin(t * 2.2) + 1) / 2
    aR!.rotation.x = aL!.rotation.x = -2.7 + w * 2
    f.body.rotation.x = 0.12 * w
  } else if (pose === 'fish') {
    aR!.rotation.x = -0.9 + Math.sin(t * 1.2) * 0.05
    aL!.rotation.x = -0.8
  } else if (pose === 'water') {
    const s = Math.sin(t * 6)
    lL!.rotation.x = s * 0.4
    lR!.rotation.x = -s * 0.4
    aR!.rotation.x = -1.15
    lift = Math.abs(Math.cos(t * 6)) * 0.02
  } else if (pose === 'sit') {
    lL!.rotation.x = lR!.rotation.x = -1.45
    aL!.rotation.x = aR!.rotation.x = -0.6
    lift = -0.3
  } else {
    f.body.scale.y = 1 + Math.sin(t * 2.2) * 0.015
    aL!.rotation.z = -0.06
    aR!.rotation.z = 0.06
  }
  f.g.position.y = f.baseY + lift
}
