import type { TeamPrRow } from '../../../../shared/team-panel-model-types'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

// Placeholder until ORCA-1073 draws this tab; the registry already routes it here.
export function TeamPanelPrsTab(
  _props: TeamPanelTabBodyProps<TeamPrRow[]>
): React.JSX.Element | null {
  return null
}
