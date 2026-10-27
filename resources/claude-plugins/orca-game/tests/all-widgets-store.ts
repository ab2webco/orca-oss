import { PANEL_SECTIONS } from '../hooks/panel-layout'

// Why: these tests draw catalog widgets (To Do, Actions, Review), which a new Panel does not show.
// Plain data only: the engine copies a store value across, and a Proxy cannot be copied.
export const allWidgetsStore = (projects: readonly string[]) => ({
  version: 2,
  projects: Object.fromEntries(
    projects.map((project) => [
      project,
      { fleet: { order: PANEL_SECTIONS, collapsed: [], shown: PANEL_SECTIONS } }
    ])
  )
})
