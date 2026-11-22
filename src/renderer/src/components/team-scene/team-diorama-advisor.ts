import { FIGURES_ADVISOR_LOOK } from '../../../../shared/team-scene/team-scene-member-looks'
import * as THREE from 'three'
import { dioramaCuePhase, type DioramaCue } from '../../../../shared/team-scene/team-diorama-cues'
import { DIORAMA_TOWER_AT, DIORAMA_TOWER_PLATFORM } from './team-diorama-camp'
import { dioramaFigure, type DioramaFigure } from './team-diorama-figures'
import { dioramaChip } from './team-diorama-fx'
import type { DioramaKit } from './team-diorama-kit'
import { poseDioramaFigure } from './team-diorama-poses'

// Why a lookout: Jev watches the whole base from its tower with a spyglass and, when it decides,
// lowers it to speak and sends its messenger bird (owner, ORCA-1296).

/** The tower's platform, where the advisor stands; the tower itself is one of the home props. */
export const DIORAMA_TOWER = new THREE.Vector3(
  DIORAMA_TOWER_AT[0],
  DIORAMA_TOWER_PLATFORM,
  DIORAMA_TOWER_AT[1]
)
const TOWARD_VIEW = Math.PI / 4

export type DioramaAdvisor = { figure: DioramaFigure; tick: (t: number) => void }

export function dioramaAdvisor(
  k: DioramaKit,
  parent: THREE.Object3D,
  cues: readonly DioramaCue[],
  lite: boolean,
  line: string | null
): DioramaAdvisor {
  const figure = dioramaFigure(k, FIGURES_ADVISOR_LOOK, { lite })
  figure.g.position.set(DIORAMA_TOWER.x, 0, DIORAMA_TOWER.z)
  figure.baseY = DIORAMA_TOWER.y
  parent.add(figure.g)
  const talks = cues.filter((c) => c.kind === 'talk')
  // Why above the roof: Jev's line shows while it speaks, as the prototype's label does.
  const label = line ? dioramaChip(line) : null
  if (label) {
    label.center.set(0.5, 0)
    label.position.set(DIORAMA_TOWER.x, DIORAMA_TOWER.y + 3.9, DIORAMA_TOWER.z)
    label.visible = false
    parent.add(label)
  }
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
      if (label) {
        label.visible = talking
      }
    }
  }
}
