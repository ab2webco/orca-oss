import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { searchKeywords } from './settings-search-keywords'

/** Settings search for the panel rows, in the Agents pane and in each project's game section. */
export const getGamePanelSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.OrchestratorGamePanelSetting.title', 'Panel'),
    description: translate(
      'auto.components.settings.OrchestratorGamePanelSetting.description',
      'The right sidebar panel for your agents. Each project can change it in its own settings.'
    ),
    keywords: searchKeywords([
      'team',
      'tabs',
      {
        key: 'auto.components.settings.OrchestratorGamePanelSetting.look',
        fallback: 'Panel look'
      },
      {
        key: 'auto.components.settings.OrchestratorGamePanelSetting.style',
        fallback: 'Scene style'
      },
      {
        key: 'auto.components.settings.OrchestratorGamePanelSetting.prs',
        fallback: 'PRs'
      },
      {
        key: 'auto.components.settings.OrchestratorGamePanelSetting.queue',
        fallback: 'Queue'
      },
      {
        key: 'auto.components.settings.OrchestratorGamePanelSetting.machines',
        fallback: 'Machines'
      },
      {
        key: 'auto.components.settings.OrchestratorGamePanelSetting.advisor',
        fallback: 'Advisor'
      },
      {
        key: 'auto.components.settings.OrchestratorGamePanelSetting.arcade',
        fallback: 'Arcade'
      }
    ])
  }
])
