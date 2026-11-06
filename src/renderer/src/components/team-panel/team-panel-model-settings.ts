import type { OrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel'
import type { TeamPanelModel } from '../../../../shared/team-panel-model-types'

// Why on the model: a null tab section is already "hidden" to the registry, so ORCA-1091 can
// repoint the Queue toggle at the PRs tab's queue section here without touching the tabs.
/** The model with the tabs and the Advisor row the panel settings turn off removed. */
export function teamPanelModelWithSettings(
  model: TeamPanelModel,
  panel: Pick<OrchestratorGamePanel, 'tabs' | 'advisor'>
): TeamPanelModel {
  const tabs = {
    prs: panel.tabs.prs ? model.prs : null,
    queue: panel.tabs.queue ? model.queue : null,
    machines: panel.tabs.machines ? model.machines : null
  }
  return model.kind === 'team'
    ? { ...model, ...tabs, advisor: panel.advisor ? model.advisor : null }
    : { ...model, ...tabs }
}
