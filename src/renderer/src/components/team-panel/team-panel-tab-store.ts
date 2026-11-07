import { create } from 'zustand'
import type { TeamTabId } from '../../../../shared/team-panel-model-types'

type TeamPanelTabState = {
  /** Null opens the first tab; a stored tab the model hides falls back the same way. */
  selected: TeamTabId | null
  /** The tab the open panel really draws, which a hidden stored tab differs from. */
  shown: TeamTabId | null
  select: (tab: TeamTabId) => void
  publishShown: (tab: TeamTabId | null) => void
}

// Why: outside the panel so switching sidebar tabs, which unmounts it, keeps the user's tab.
export const useTeamPanelTabStore = create<TeamPanelTabState>((set) => ({
  selected: null,
  shown: null,
  select: (tab) => set({ selected: tab }),
  publishShown: (tab) => set({ shown: tab })
}))
