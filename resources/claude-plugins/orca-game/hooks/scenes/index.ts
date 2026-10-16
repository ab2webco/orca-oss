import { QUEST_SCENE } from './quest'
import type { SceneDefinition } from './scene-definition'

export type { Card, Costume, Look, SceneDefinition, ScenePhase } from './scene-definition'

export const DEFAULT_SCENE_ID = 'quest'

// A new scene is one file in this folder plus its entry here.
export const SCENES: Readonly<Record<string, SceneDefinition>> = {
  [QUEST_SCENE.id]: QUEST_SCENE
}

export const sceneOf = (id: string | undefined): SceneDefinition =>
  (id === undefined ? undefined : SCENES[id]) ?? QUEST_SCENE
