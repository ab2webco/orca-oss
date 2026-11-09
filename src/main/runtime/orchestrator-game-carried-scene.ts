import { readWorktreeOrcaYaml } from '../worktree-orca-yaml'
import { readWorktreeGameSceneFile } from '../worktree-game-scene-file'
import {
  resolveOrchestratorGameConfig,
  type ResolvedOrchestratorGameConfig
} from '../../shared/orchestrator-game-config'
import { parseOrchestratorGameScene } from '../../shared/orchestrator-game-scene'
import type { OrchestratorGameStateInput } from './orchestrator-game-state-input'

/** A lead's scene file as written, sent to a remote member's host (ORCA-794). */
export type CarriedGameScene = { id: string; text: string }

export type GameSceneWorktree = { repoId: string | null; path: string; connectionId: string | null }

/** The worktree's game config across its layers, as game.state resolves it. */
export async function resolveWorktreeGameConfig(
  settings: OrchestratorGameStateInput['settings'],
  worktree: GameSceneWorktree
): Promise<ResolvedOrchestratorGameConfig> {
  const project = await readWorktreeOrcaYaml(worktree.path, worktree.connectionId)
  return resolveOrchestratorGameConfig({
    global: settings?.orchestratorGame,
    project: project?.orchestratorGame,
    local: worktree.repoId ? settings?.orchestratorGameProjects?.[worktree.repoId] : undefined
  })
}

/** The lead's own scene file, or null when it draws none or the file does not read. */
export async function readLeadGameScene(args: {
  settings: OrchestratorGameStateInput['settings']
  worktree: GameSceneWorktree
}): Promise<CarriedGameScene | null> {
  const { settings, worktree } = args
  const resolved = await resolveWorktreeGameConfig(settings, worktree)
  if (resolved.sceneFile === null) {
    return null
  }
  const id = resolved.config.scene
  const text = await readWorktreeGameSceneFile(
    worktree.path,
    worktree.connectionId,
    resolved.sceneFile
  ).catch(() => null)
  return text !== null && parseOrchestratorGameScene(text, id).ok ? { id, text } : null
}
