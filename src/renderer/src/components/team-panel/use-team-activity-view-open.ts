import { useAppStore } from '@/store'
import { useTeamPanelTabStore } from './team-panel-tab-store'

/** True while the right sidebar draws the no-team Activity view, which repeats the hover card. */
export function useTeamActivityViewOpen(): boolean {
  const teamTabOpen = useAppStore((s) => s.rightSidebarOpen && s.rightSidebarTab === 'team')
  const onActivity = useTeamPanelTabStore((s) => s.shown === 'activity')
  return teamTabOpen && onActivity
}
