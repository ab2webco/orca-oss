import type { TeamInboxCounts } from '../../../../shared/team-panel-model-types'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

// Placeholder until ORCA-1072 draws this tab; the registry already routes it here.
export function TeamPanelInboxTab(
  _props: TeamPanelTabBodyProps<TeamInboxCounts>
): React.JSX.Element | null {
  return null
}
