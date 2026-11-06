import type { SettingsNavigationTarget } from '@/lib/settings-navigation-types'
import {
  GAME_PANEL_GLOBAL_SECTION_ID,
  getRepositoryGameSectionId
} from './repository-settings-targets'

type SettingsActions = {
  openSettingsTarget: (target: SettingsNavigationTarget) => void
  openSettingsPage: () => void
}

/** The panel gear: the project's game section with a team, the global Panel section without one. */
export function openGamePanelSettings(actions: SettingsActions, repoId: string | null): void {
  actions.openSettingsTarget(
    repoId
      ? { pane: 'repo', repoId, sectionId: getRepositoryGameSectionId(repoId) }
      : {
          pane: 'agents',
          repoId: null,
          sectionId: GAME_PANEL_GLOBAL_SECTION_ID
        }
  )
  actions.openSettingsPage()
}
