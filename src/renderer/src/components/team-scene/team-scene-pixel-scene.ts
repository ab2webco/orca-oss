import { dayOf } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { SCENES } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import type { SceneDefinition } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/scene-definition'
import { themedSceneOf } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/scene-theme'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'

/**
 * The scene Pixel draws, resolved as the mod does: a built-in by id, else the plugin or file
 * definition game state carries, else Quest; then the theme of the project's day.
 */
export function teamScenePixelSceneOf(args: {
  sceneId: string
  extensions?: OrchestratorGameState['extensions']
  nowMs: number
  timezone: string
}): SceneDefinition {
  const carried = args.extensions?.scenes.find((one) => one.id === args.sceneId)?.definition
  // Why the cast: the desktop parser's output is structurally the mod's SceneDefinition.
  const scene = Object.hasOwn(SCENES, args.sceneId)
    ? SCENES[args.sceneId]!
    : ((carried as unknown as SceneDefinition | undefined) ?? QUEST_SCENE)
  return themedSceneOf(scene, dayOf(args.nowMs, args.timezone))
}
