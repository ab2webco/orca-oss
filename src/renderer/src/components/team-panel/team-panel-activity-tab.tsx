import type { TeamPanelSoloModel } from '../../../../shared/team-panel-model-types'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

// Placeholder until ORCA-1074 draws this tab; the registry already routes it here.
export function TeamPanelActivityTab(
  _props: TeamPanelTabBodyProps<TeamPanelSoloModel>
): React.JSX.Element | null {
  return null
}
