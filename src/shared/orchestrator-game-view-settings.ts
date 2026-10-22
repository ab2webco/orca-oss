import {
  resolveOrchestratorGameConfig,
  type OrchestratorGameConfig,
  type OrchestratorGameLayer
} from './orchestrator-game-config'
import {
  orchestratorGameViewPatchOf,
  type OrchestratorGameViewId,
  type OrchestratorGameViewScope
} from './orchestrator-game-view'
import type { GlobalSettings } from './types'

/** What `orca game view` stored: `local` is the repo's own layer on this machine. */
export type OrchestratorGameViewWrite = {
  view: OrchestratorGameViewId
  scope: OrchestratorGameViewScope
  layer: 'global' | 'local'
}

type GameSettings = Partial<Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>>

/** The layer with a view stored in it; picking a view other than off also shows a hidden game. */
function withView(
  layer: OrchestratorGameLayer | undefined,
  view: OrchestratorGameViewId,
  now: OrchestratorGameConfig
): OrchestratorGameLayer {
  return {
    ...layer,
    ...orchestratorGameViewPatchOf(view, now),
    ...(view !== 'off' && !now.show ? { show: true } : {})
  }
}

/** The settings update that stores a view for every project or for one repo on this machine. */
export function orchestratorGameViewSettingsOf(
  settings: GameSettings,
  args: { view: OrchestratorGameViewId; scope: OrchestratorGameViewScope; repoId?: string | null }
): GameSettings {
  const global = settings.orchestratorGame
  if (args.scope === 'global') {
    const now = resolveOrchestratorGameConfig({ global }).config
    return { orchestratorGame: withView(global, args.view, now) }
  }
  if (!args.repoId) {
    throw new Error(
      'This pane has no project to store a view for; pick this pane or every project.'
    )
  }
  const local = settings.orchestratorGameProjects?.[args.repoId]
  const now = resolveOrchestratorGameConfig({ global, local }).config
  return {
    orchestratorGameProjects: {
      ...settings.orchestratorGameProjects,
      [args.repoId]: withView(local, args.view, now)
    }
  }
}
