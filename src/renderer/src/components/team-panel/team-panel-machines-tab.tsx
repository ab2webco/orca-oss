import type { TeamMachine } from '../../../../shared/team-panel-model-types'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

// Placeholder until ORCA-1073 draws this tab; the registry already routes it here.
export function TeamPanelMachinesTab(
  _props: TeamPanelTabBodyProps<TeamMachine[]>
): React.JSX.Element | null {
  return null
}
