import { readWorktreeOrcaYaml } from '../worktree-orca-yaml'
import { readWorktreeGameSceneFile } from '../worktree-game-scene-file'
import { resolveOrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import { parseOrchestratorGameScene } from '../../shared/orchestrator-game-scene'
import type { OrchestratorGameStateInput } from './orchestrator-game-state-builder'

/** A lead's scene file as written, sent to a remote member's host (ORCA-794). */
export type CarriedGameScene = { id: string; text: string }

/** The lead's own scene file, or null when it draws none or the file does not read. */
export async function readLeadGameScene(args: {
  settings: OrchestratorGameStateInput['settings']
  worktree: { repoId: string | null; path: string; connectionId: string | null }
}): Promise<CarriedGameScene | null> {
  const { settings, worktree } = args
  const project = await readWorktreeOrcaYaml(worktree.path, worktree.connectionId)
  const resolved = resolveOrchestratorGameConfig({
    global: settings?.orchestratorGame,
    project: project?.orchestratorGame,
    local: worktree.repoId ? settings?.orchestratorGameProjects?.[worktree.repoId] : undefined
  })
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
