import type { TeamPanelModel, TeamSection } from '../../../../shared/team-panel-model-types'

export type TeamPanelModelSource = {
  section: TeamSection<TeamPanelModel>
  /** Null when there is nothing to retry. */
  retry: (() => void) | null
}

const UNAVAILABLE: TeamPanelModelSource = {
  section: { kind: 'unavailable' },
  retry: null
}

/**
 * The Team panel's only data source. ORCA-1049 replaces this body with the real model.
 * Why: the activity bar and the panel both call it, so it must stay a shared subscription.
 */
export function useTeamPanelModel(): TeamPanelModelSource {
  return UNAVAILABLE
}
