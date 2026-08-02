import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { SWITCH_ACCOUNT_SKILL_NAME } from './agent-feature-install-commands'
import type { SkillUsageExample } from './skill-usage-example'

const SWITCH_ACCOUNT_SLASH_COMMAND = `/${SWITCH_ACCOUNT_SKILL_NAME}`

export const getAccountSwitchUsageExamples = createLocalizedCatalog((): SkillUsageExample[] => [
  {
    id: 'list-accounts',
    title: translate('auto.lib.accountSwitch.usage.examples.listAccounts', 'See the accounts'),
    summary: translate(
      'auto.lib.accountSwitch.usage.examples.listAccountsSummary',
      'List the managed Claude accounts with their cached quota before choosing one.'
    ),
    prompt: translate(
      'auto.lib.accountSwitch.usage.examples.listAccountsPrompt',
      'Run {{value0}} with no account to list my Claude accounts and their remaining quota.',
      { value0: SWITCH_ACCOUNT_SLASH_COMMAND }
    )
  },
  {
    id: 'switch-now',
    title: translate('auto.lib.accountSwitch.usage.examples.switchNow', 'Switch this terminal'),
    summary: translate(
      'auto.lib.accountSwitch.usage.examples.switchNowSummary',
      'Swap the account in place; the same conversation resumes on the new one.'
    ),
    prompt: translate(
      'auto.lib.accountSwitch.usage.examples.switchNowPrompt',
      'Use {{value0}} to switch this terminal to my other Claude account and keep going.',
      { value0: SWITCH_ACCOUNT_SLASH_COMMAND }
    )
  },
  {
    id: 'out-of-quota',
    title: translate(
      'auto.lib.accountSwitch.usage.examples.outOfQuota',
      'Move off a used-up account'
    ),
    summary: translate(
      'auto.lib.accountSwitch.usage.examples.outOfQuotaSummary',
      'Hand the rest of the work to an account that still has quota.'
    ),
    prompt: translate(
      'auto.lib.accountSwitch.usage.examples.outOfQuotaPrompt',
      'This session is out of quota — use {{value0}} to move it to the account with the most left, then continue.',
      { value0: SWITCH_ACCOUNT_SLASH_COMMAND }
    )
  }
])
