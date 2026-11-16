import type { SidebarActivityWindowHours } from './sidebar-activity-window'

/** Settings that shape the left sidebar's workspace list. */
export type SidebarListSettings = {
  /** Pinned workspaces show in one sidebar location by default; opt in to also show them in their natural groups. */
  showPinnedWorktreesInGroups?: boolean
  /** Projects idle longer than this fold into the sidebar's Idle group; optional, readers default to 24 h. */
  sidebarActivityWindowHours?: SidebarActivityWindowHours
}
