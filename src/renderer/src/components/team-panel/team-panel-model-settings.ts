import type { OrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel'
import type { TeamPanelModel } from '../../../../shared/team-panel-model-types'

// Why on the model: a null tab section is already "hidden" to the registry.
/** The model with the tabs and the Advisor row the panel settings turn off removed. */
export function teamPanelModelWithSettings(
  model: TeamPanelModel,
  panel: Pick<OrchestratorGamePanel, 'tabs' | 'advisor'> & { pluginsOn: boolean }
): TeamPanelModel {
  const tabs = {
    prs: panel.tabs.prs ? model.prs : null,
    machines: panel.tabs.machines ? model.machines : null
  }
  // Why the plugin system too: Jev reaches a pane only through its plugin, and a kept report outlives it.
  const advisor = panel.advisor && panel.pluginsOn
  if (model.kind === 'team') {
    return { ...model, ...tabs, advisor: advisor ? model.advisor : null }
  }
  return {
    ...model,
    ...tabs,
    rows: advisor ? model.rows : model.rows.map((row) => ({ ...row, advisor: null }))
  }
}
