import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

// Placeholder until ORCA-1050 draws this tab; the registry already routes it here.
export function TeamPanelTeamTab(
  _props: TeamPanelTabBodyProps<TeamPanelGameModel>
): React.JSX.Element | null {
  return null
}
