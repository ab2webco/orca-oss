import { readWorktreeGameSceneFile } from '../worktree-game-scene-file'
import type { ResolvedOrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import {
  parseOrchestratorGameScene,
  type OrchestratorGameSceneExtension
} from '../../shared/orchestrator-game-scene'
import { ORCHESTRATOR_GAME_SCENE_FILE_SOURCE } from '../../shared/orchestrator-game-scene-file'
import type { OrchestratorGameStateInput } from './orchestrator-game-state-input'
import type { CarriedGameScene } from './orchestrator-game-carried-scene'

// `notes` are parts of a scene that still draws, left out; `warning` means it fell back to Quest.
export type SceneFileOutcome =
  | { scene: OrchestratorGameSceneExtension; warning?: undefined; notes: string[] }
  | { scene?: undefined; warning: string; notes?: undefined }

// Why re-read every build: a scene being authored should redraw on the next poll, not after a restart.
export async function readSceneFile(
  resolved: ResolvedOrchestratorGameConfig,
  worktree: NonNullable<OrchestratorGameStateInput['worktree']> | null
): Promise<SceneFileOutcome | null> {
  const path = resolved.sceneFile
  if (path === null) {
    return null
  }
  const id = resolved.config.scene
  const failed = (reason: string): SceneFileOutcome => ({
    warning: `Scene file ${path}: ${reason}; drawing Quest`
  })
  if (!worktree) {
    return failed('no worktree to read it from')
  }
  let text: string
  try {
    text = await readWorktreeGameSceneFile(worktree.path, worktree.connectionId, path)
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error))
  }
  const parsed = parseOrchestratorGameScene(text, id)
  return parsed.ok
    ? {
        scene: { id, pluginId: ORCHESTRATOR_GAME_SCENE_FILE_SOURCE, definition: parsed.definition },
        notes: parsed.warnings.map((one) => `Scene file ${path}: ${one}; drawn without it`)
      }
    : failed(parsed.error)
}

/** The worktree's own scene file, else the one its member's lead draws. */
export async function readSceneFileOrCarried(
  resolved: ResolvedOrchestratorGameConfig,
  worktree: NonNullable<OrchestratorGameStateInput['worktree']> | null,
  readCarried: (() => Promise<CarriedGameScene | null>) | undefined
): Promise<SceneFileOutcome | null> {
  const own = await readSceneFile(resolved, worktree)
  const carried = own?.scene || !readCarried ? null : await readCarried().catch(() => null)
  const parsed = carried ? parseOrchestratorGameScene(carried.text, carried.id) : null
  return carried && parsed?.ok
    ? {
        scene: {
          id: carried.id,
          pluginId: ORCHESTRATOR_GAME_SCENE_FILE_SOURCE,
          definition: parsed.definition
        },
        notes: []
      }
    : own
}
