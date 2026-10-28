import { JRPG_SCENE } from './jrpg'
import { QUEST_SCENE } from './quest'
import type { SceneDefinition } from './scene-definition'
import { TAMER_SCENE } from './tamer'
import { VIGILANTE_SCENE } from './vigilante'

export type {
  AdvisorGesture,
  Card,
  CastFrame,
  CharacterAccessory,
  CharacterVariant,
  Costume,
  HudPalette,
  Look,
  SceneAdvisor,
  SceneCast,
  SceneCharacter,
  SceneDefinition,
  ScenePet,
  ScenePhase
} from './scene-definition'

export const DEFAULT_SCENE_ID = 'quest'

// A new scene is one file in this folder plus its entry here and in Orca's
// ORCHESTRATOR_GAME_BUILT_IN_SCENES, so Settings offers it.
export const SCENES: Readonly<Record<string, SceneDefinition>> = {
  [QUEST_SCENE.id]: QUEST_SCENE,
  [VIGILANTE_SCENE.id]: VIGILANTE_SCENE,
  [JRPG_SCENE.id]: JRPG_SCENE,
  [TAMER_SCENE.id]: TAMER_SCENE
}

// Scenes Orca's plugins contribute, replaced on every poll of `orca game state`.
let contributed = new Map<string, SceneDefinition>()

export const setContributedScenes = (scenes: readonly SceneDefinition[]): boolean => {
  const next = new Map(scenes.map((scene) => [scene.id, scene]))
  const isSame =
    next.size === contributed.size &&
    [...next].every(([id, scene]) => JSON.stringify(contributed.get(id)) === JSON.stringify(scene))
  contributed = next
  return !isSame
}

export const sceneOf = (id: string | undefined): SceneDefinition => {
  if (id === undefined) {
    return QUEST_SCENE
  }
  return (Object.hasOwn(SCENES, id) ? SCENES[id] : contributed.get(id)) ?? QUEST_SCENE
}
