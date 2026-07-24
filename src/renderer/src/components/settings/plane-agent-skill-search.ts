import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getPlaneAgentSkillPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.plane.agent.skill.search.title', 'Plane'),
    description: translate(
      'auto.components.settings.plane.agent.skill.search.description',
      'Give agents the skill to read and update your Plane work items.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.plane.agent.skill.search.plane', 'plane'),
      ...translateSearchKeyword(
        'auto.components.settings.plane.agent.skill.search.workItems',
        'work items'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.plane.agent.skill.search.issues',
        'issues'
      ),
      ...translateSearchKeyword('auto.components.settings.plane.agent.skill.search.skill', 'skill'),
      ...translateSearchKeyword(
        'auto.components.settings.plane.agent.skill.search.orcaPlane',
        'orca-plane'
      )
    ]
  }
])
