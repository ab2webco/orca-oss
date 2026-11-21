import type { Office3dPose } from '../../../../shared/team-scene/team-office3d-actions'
import type { TeamScenePlay } from '../../../../shared/team-scene/team-scene-types'
import type { DioramaFigure } from './team-diorama-figures'
import { poseDioramaFigure } from './team-diorama-poses'

// Why on the diorama's sit: a seated developer keeps the diorama's legs and lift, and only its
// arms, back and head tell what it is doing at the desk (ORCA-1302).

/** Where a seated figure stands so its hips rest on a chair's cushion (top 0.58): the diorama's
 * sit lowers the body 0.3 and the legs hang from 0.34, at the 1.6 scale. */
export const OFFICE3D_SIT_Y = 0.58 - (0.34 - 0.3) * 1.6

/** What a seated figure shows: its desk pose, a play while resting, or a moment's cheer or give. */
export type Office3dSeatedPose = Office3dPose | TeamScenePlay | 'cheer' | 'give'

/** Poses a seated `f`, facing its monitor, at time `t`; still when `t` stays put. */
export function poseOffice3dSeated(f: DioramaFigure, pose: Office3dSeatedPose, t: number): void {
  poseDioramaFigure(f, 'sit', t)
  const [aL, aR] = f.arms as [DioramaFigure['arms'][0], DioramaFigure['arms'][0]]
  const s = (freq: number, phase = 0) => Math.sin(t * freq + phase)
  f.head.rotation.z = 0
  if (pose === 'type' || pose === 'game') {
    // Why low, near-still forearms: arms swinging in turn read as steering a wheel, not typing.
    const tap = pose === 'game' ? 0.05 : 0.03
    const freq = pose === 'game' ? 22 : 17
    aL.rotation.x = -1 + Math.max(0, s(freq)) * tap
    aR.rotation.x = -1 + Math.max(0, s(freq, 1.3)) * tap
    aL.rotation.z = 0.08
    aR.rotation.z = -0.08
    f.body.rotation.x = 0.06
    f.head.rotation.x = 0.14 + s(0.7) * 0.03
  } else if (pose === 'raise') {
    // Why the left hand: seen from behind, it is the side the camera sees clear of the monitor.
    aL.rotation.z = -2.6 + s(5) * 0.22
    aL.rotation.x = -0.2
    aR.rotation.x = -1.1
    f.head.rotation.x = -0.12
  } else if (pose === 'cheer') {
    aL.rotation.z = -2.55 - s(4) * 0.2
    aR.rotation.z = 2.55 - s(4) * 0.2
    f.g.rotation.z = s(4) * 0.05
  } else if (pose === 'done') {
    aL.rotation.x = aR.rotation.x = -0.2
    aL.rotation.z = -0.12
    aR.rotation.z = 0.12
    f.body.rotation.x = -0.1
    f.head.rotation.x = -0.14
  } else if (pose === 'slump') {
    aL.rotation.x = aR.rotation.x = -1.35
    aL.rotation.z = 0.35
    aR.rotation.z = -0.35
    f.body.rotation.x = 0.32
    f.head.rotation.x = 0.6
  } else if (pose === 'music') {
    aL.rotation.x = aR.rotation.x = -0.7
    f.head.rotation.z = s(3.2) * 0.14
    f.body.rotation.z = s(3.2, 0.4) * 0.04
  } else if (pose === 'sketch') {
    aL.rotation.x = -1.5
    aL.rotation.z = 0.15
    aR.rotation.x = -1.25 + s(9) * 0.08
    aR.rotation.z = -0.45 + s(6) * 0.06
    f.head.rotation.x = 0.3
  } else if (pose === 'plane') {
    const p = t % 5
    if (p < 3) {
      aL.rotation.x = aR.rotation.x = -1.7 + s(7) * 0.08
      aL.rotation.z = 0.3
      aR.rotation.z = -0.3
      f.head.rotation.x = 0.25
    } else {
      aL.rotation.x = -2.7 + (p - 3) * 0.8
      aR.rotation.x = -0.6
    }
  } else if (pose === 'give') {
    aL.rotation.x = -1.45
    aR.rotation.x = -0.6
  } else {
    aL.rotation.x = aR.rotation.x = -0.65
  }
}
