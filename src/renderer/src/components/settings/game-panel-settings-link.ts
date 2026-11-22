import type { SettingsNavigationTarget } from '@/lib/settings-navigation-types'
import {
  GAME_PANEL_GLOBAL_SECTION_ID,
  getRepositoryGameSectionId
} from './repository-settings-targets'

type SettingsActions = {
  openSettingsTarget: (target: SettingsNavigationTarget) => void
  openSettingsPage: () => void
}

/** The panel gear: the given project's game section, or the global Panel section with no project. */
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
