import {
  frameSpriteOf,
  type HdSprite
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-sprite'
import {
  advisorFrameOf,
  petFrameOf
} from '../../../../../resources/claude-plugins/orca-game/hooks/scene-cast'
import type { SceneDefinition } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/scene-definition'
import type {
  TeamSceneActor,
  TeamSceneGesture
} from '../../../../shared/team-scene/team-scene-types'

// The game's SCENE_TICK_MS: the cast's frames step on the band's clock.
const TICK_MS = 120

const tickOf = (t: number): number => Math.floor((t * 1000) / TICK_MS)

/** The scene's own advisor figure, in its gesture's frame when it has one; null for a costume. */
export function pixelAdvisorSpriteOf(
  scene: SceneDefinition,
  t: number,
  gesture?: TeamSceneGesture | null
): HdSprite | null {
  const advisor = scene.cast?.advisor
  if (!advisor) {
    return null
  }
  const pose = { sprite: advisor, age: 0, bubble: '', ...(gesture ? { gesture } : {}) }
  const frame = advisorFrameOf(pose, tickOf(t))
  return frameSpriteOf(frame, advisor.colors)
}

/** The scene's pet at the lead's heels, behind it as it faces; null when the scene has none. */
export function pixelPetOf(
  scene: SceneDefinition,
  lead: TeamSceneActor | undefined,
  leadLeft: number,
  leadWidth: number,
  t: number
): { sprite: HdSprite; left: number } | null {
  const pet = scene.cast?.pet
  if (!pet || !lead) {
    return null
  }
  const sprite = frameSpriteOf(petFrameOf(pet, tickOf(t), lead.pose !== 'walk', false), pet.colors)
  const left = lead.facing < 0 ? leadLeft + leadWidth : leadLeft - sprite.width
  return { sprite, left }
}
