import { withGamePanelField, type GamePanelTab } from './orchestrator-game-panel'
import type { GlobalSettings } from './types'

type GameSettings = Partial<Pick<GlobalSettings, 'orchestratorGameProjects'>>

/** What `orca game hide-tab` did; `changed` is false when the project had already chosen. */
export type OrchestratorGamePanelTabWrite = { tab: GamePanelTab; changed: boolean }

/** The update that hides a tab on one repo's layer; null when that layer already says. */
export function gamePanelTabHiddenSettingsOf(
  settings: GameSettings,
  repoId: string,
  tab: GamePanelTab
): GameSettings | null {
  const projects = settings.orchestratorGameProjects
  const layer = projects?.[repoId]
  if (layer?.panel?.tabs?.[tab] !== undefined) {
    return null
  }
  return {
    orchestratorGameProjects: { ...projects, [repoId]: withGamePanelField(layer, tab, false) }
  }
}
