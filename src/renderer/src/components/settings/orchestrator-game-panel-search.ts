import { translate } from '@/i18n/i18n'
import { searchKeywords } from './settings-search-keywords'
import { gameRowSearchKeywords } from './orchestrator-game-row-search'
import { shownGameRows, type GameRowFacts } from './orchestrator-game-row-visibility'
import { ORCHESTRATOR_GAME_SETTING_KEYWORDS } from './orchestrator-game-setting-keywords'

const panelTitle = (): string =>
  translate('auto.components.settings.OrchestratorGamePanelSetting.title', 'Panel')

/** Settings search for the panel rows; with facts, only the rows the page shows (ORCA-1112). */
export function getGamePanelSearchEntries(facts?: GameRowFacts) {
  const shown = facts === undefined ? undefined : shownGameRows(facts)
  return [
    {
      title: panelTitle(),
      description: translate(
        'auto.components.settings.OrchestratorGamePanelSetting.description',
        'The right sidebar panel for your agents. Each project can change it in its own settings.'
      ),
      keywords: searchKeywords(['team', 'tabs', ...gameRowSearchKeywords(['panel'], shown)])
    }
  ]
}

export const agentTeamsGameTitle = (): string =>
  translate('auto.components.settings.OrchestratorGameSetting.title', 'Agent Teams game')

/** The Agent Teams section's search: its own words plus the terminal rows the page shows. */
export function getAgentTeamsGameSearchEntry(facts?: GameRowFacts) {
  const shown = facts === undefined ? undefined : shownGameRows(facts)
  const groups =
    facts?.page === 'project'
      ? (['panel', 'terminal', 'band'] as const)
      : (['terminal', 'band'] as const)
  return {
    title: agentTeamsGameTitle(),
    description: translate(
      'auto.components.settings.OrchestratorGameSetting.description',
      'Pixel-art scenes, a teammate HUD and rewards inside Claude Agent Teams. Each project can change this in its orca.yaml.'
    ),
    keywords: searchKeywords([
      ...ORCHESTRATOR_GAME_SETTING_KEYWORDS,
      ...gameRowSearchKeywords(groups, shown)
    ])
  }
}

/** The game's search entry titles; the project's game section lives inside Identity. */
export const gameSearchEntryTitles = (): string[] => [panelTitle(), agentTeamsGameTitle()]
