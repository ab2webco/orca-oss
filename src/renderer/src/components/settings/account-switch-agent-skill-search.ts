import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getAccountSwitchAgentSkillPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate(
      'auto.components.settings.accountSwitch.agent.skill.search.title',
      'Account switching'
    ),
    description: translate(
      'auto.components.settings.accountSwitch.agent.skill.search.description',
      'Let agents switch this terminal to another Claude account without losing the conversation.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.accountSwitch.agent.skill.search.account',
        'account'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.accountSwitch.agent.skill.search.switchAccount',
        'switch account'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.accountSwitch.agent.skill.search.skillName',
        'switch-account'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.accountSwitch.agent.skill.search.claudeAccount',
        'claude account'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.accountSwitch.agent.skill.search.rateLimit',
        'rate limit'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.accountSwitch.agent.skill.search.quota',
        'quota'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.accountSwitch.agent.skill.search.skill',
        'skill'
      )
    ]
  }
])
