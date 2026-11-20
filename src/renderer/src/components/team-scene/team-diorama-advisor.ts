import * as THREE from 'three'
import { dioramaCuePhase, type DioramaCue } from '../../../../shared/team-scene/team-diorama-cues'
import { dioramaFigure, type DioramaFigure } from './team-diorama-figures'
import type { DioramaKit } from './team-diorama-kit'
import { poseDioramaFigure } from './team-diorama-poses'

// Why a lookout: Jev watches the whole base from its tower with a spyglass and, when it decides,
// lowers it to speak and sends its messenger bird (owner, ORCA-1296).

/** The tower's platform, where the advisor stands; the tower itself is one of the home props. */
export const DIORAMA_TOWER = new THREE.Vector3(-0.9, 2.37, -5.3)
const TOWARD_VIEW = Math.PI / 4

export type DioramaAdvisor = { figure: DioramaFigure; tick: (t: number) => void }

export function dioramaAdvisor(
  k: DioramaKit,
  parent: THREE.Object3D,
  cues: readonly DioramaCue[],
  lite: boolean
): DioramaAdvisor {
  const figure = dioramaFigure(k, 1, { role: 'advisor', lite })
  figure.g.position.set(DIORAMA_TOWER.x, 0, DIORAMA_TOWER.z)
  figure.baseY = DIORAMA_TOWER.y
  parent.add(figure.g)
  const talks = cues.filter((c) => c.kind === 'talk')
  let yaw = TOWARD_VIEW
  return {
    figure,
    tick: (t) => {
      const talking = talks.some((c) => {
        const ph = dioramaCuePhase(c, t)
        return ph >= 0 && ph < 1
      })
      // Why eased: it turns from scanning to face the view over a few frames, never in one.
      const goal = talking ? TOWARD_VIEW : TOWARD_VIEW + Math.sin(t * 0.45) * 0.9
      yaw += (goal - yaw) * 0.12
      figure.g.rotation.y = yaw
      poseDioramaFigure(figure, talking ? 'talk' : 'spy', t)
    }
  }
}
