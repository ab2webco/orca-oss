import { useAppStore } from '@/store'
import { useTeamPanelKind } from './use-team-panel-model'
import { useTeamPanelTabStore } from './team-panel-tab-store'

/** True while the right sidebar shows the no-team Activity view, which repeats the hover card. */
export function useTeamActivityViewOpen(): boolean {
  const teamTabOpen = useAppStore((s) => s.rightSidebarOpen && s.rightSidebarTab === 'team')
  const kind = useTeamPanelKind()
  // Why: Team is hidden without a team, so a stored Team tab falls back to Activity.
  const onActivity = useTeamPanelTabStore(
    (s) => s.selected === null || s.selected === 'activity' || s.selected === 'team'
  )
  return teamTabOpen && kind === 'solo' && onActivity
}
