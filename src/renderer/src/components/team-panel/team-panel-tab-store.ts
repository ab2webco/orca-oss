import { create } from 'zustand'
import type { TeamTabId } from '../../../../shared/team-panel-model-types'

type TeamPanelTabState = {
  /** Null opens the first tab; a stored tab the model hides falls back the same way. */
  selected: TeamTabId | null
  select: (tab: TeamTabId) => void
}

// Why: outside the panel so switching sidebar tabs, which unmounts it, keeps the user's tab.
export const useTeamPanelTabStore = create<TeamPanelTabState>((set) => ({
  selected: null,
  select: (tab) => set({ selected: tab })
}))
