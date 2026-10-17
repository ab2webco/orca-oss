import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getOrcaGameScenesSkillSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate(
      'auto.components.settings.orcaGameScenes.skill.search.title',
      'Game scenes skill'
    ),
    description: translate(
      'auto.components.settings.orcaGameScenes.skill.search.description',
      'Let agents create, restyle and fix custom scenes for the Agent Teams game.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.orcaGameScenes.skill.search.skillName',
        'orca-game-scenes'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.orcaGameScenes.skill.search.scene',
        'scene'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.orcaGameScenes.skill.search.customScene',
        'custom scene'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.orcaGameScenes.skill.search.theme',
        'theme'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.orcaGameScenes.skill.search.skin',
        'skin'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.orcaGameScenes.skill.search.agentTeams',
        'agent teams'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.orcaGameScenes.skill.search.game',
        'game'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.orcaGameScenes.skill.search.skill',
        'skill'
      )
    ]
  }
])
