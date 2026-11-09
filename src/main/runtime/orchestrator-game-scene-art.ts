import {
  GameSceneFileReadError,
  readWorktreeGameSceneArt,
  type GameSceneArtImage
} from '../worktree-game-scene-file'
import {
  resolveWorktreeGameConfig,
  type GameSceneWorktree
} from './orchestrator-game-carried-scene'
import type { OrchestratorGameStateInput } from './orchestrator-game-state-input'

/**
 * One image of the scene file a worktree draws, read on the host that owns it.
 * Why the scene id: the caller names what it draws, and only that scene's folder is served.
 */
export async function readGameSceneArt(args: {
  settings: OrchestratorGameStateInput['settings']
  worktree: GameSceneWorktree
  sceneId: string
  src: string
}): Promise<GameSceneArtImage> {
  const { settings, worktree, sceneId, src } = args
  const resolved = await resolveWorktreeGameConfig(settings, worktree)
  if (resolved.sceneFile === null || resolved.config.scene !== sceneId) {
    throw new GameSceneFileReadError(`${sceneId} is not the scene this worktree draws`)
  }
  return readWorktreeGameSceneArt(worktree.path, worktree.connectionId, resolved.sceneFile, src)
}
