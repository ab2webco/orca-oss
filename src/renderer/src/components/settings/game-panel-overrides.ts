import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import {
  GAME_PANEL_TABS,
  parseGamePanel,
  withGamePanelField,
  type GamePanelField,
  type GamePanelTab,
  type GamePanelValue,
  type OrchestratorGamePanel
} from '../../../../shared/orchestrator-game-panel'
import { resolveOrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel-layers'

/** Where a project's winning value comes from: orca.yaml, this machine, or its Default view. */
export type GamePanelOverrideSource = 'project' | 'local' | 'view'

export type GamePanelOverride = {
  repoId: string
  source: GamePanelOverrideSource
  value: GamePanelValue
}

export type GamePanelProjectLayers = {
  repoId: string
  project?: OrchestratorGameLayer
  local?: OrchestratorGameLayer
}

const isTab = (field: GamePanelField): field is GamePanelTab =>
  (GAME_PANEL_TABS as readonly string[]).includes(field)

/** The value a layer sets for a field; only a valid key counts, so a bad hand edit names nothing. */
export const ownGamePanelValueOf = (
  layer: OrchestratorGameLayer | undefined,
  field: GamePanelField
): GamePanelValue | undefined => {
  const panel = parseGamePanel(layer?.panel ?? {}).value ?? {}
  return isTab(field) ? panel.tabs?.[field] : panel[field]
}

export const gamePanelValueOf = (
  panel: OrchestratorGamePanel,
  field: GamePanelField
): GamePanelValue => (isTab(field) ? panel.tabs[field] : panel[field])

/** The projects whose panel shows another value than the global row, and the layer that wins. */
export function gamePanelOverridesOf(
  field: GamePanelField,
  global: OrchestratorGameLayer | undefined,
  projects: readonly GamePanelProjectLayers[]
): GamePanelOverride[] {
  const globalValue = gamePanelValueOf(resolveOrchestratorGamePanel({ global }), field)
  return projects.flatMap(({ repoId, project, local }) => {
    const value = gamePanelValueOf(resolveOrchestratorGamePanel({ global, project, local }), field)
    if (value === globalValue) {
      return []
    }
    // Why 'view': with no layer setting the look, it follows the project's Default view.
    const source: GamePanelOverrideSource =
      ownGamePanelValueOf(local, field) !== undefined
        ? 'local'
        : ownGamePanelValueOf(project, field) !== undefined
          ? 'project'
          : 'view'
    return [{ repoId, source, value }]
  })
}

type Projects = GlobalSettings['orchestratorGameProjects']

/** Drops one panel key from a repo's layer on this machine, and the repo entry once it is empty. */
export function withoutGamePanelProjectField(
  projects: Projects,
  repoId: string,
  field: GamePanelField
): NonNullable<Projects> {
  const next = { ...projects }
  const layer = withGamePanelField(next[repoId], field, undefined)
  if (Object.keys(layer).length === 0) {
    delete next[repoId]
  } else {
    next[repoId] = layer
  }
  return next
}
