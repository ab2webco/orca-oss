import { translate } from '@/i18n/i18n'
import type { ClaudeStatusLineItemKey } from '../../../../shared/claude-statusline-items'
import { searchKeywords } from './settings-search-keywords'

export function getClaudeStatusLineTitle(): string {
  return translate(
    'auto.components.settings.claude-statusline-items-copy.title',
    'Claude status line'
  )
}

export function getClaudeStatusLineDescription(): string {
  return translate(
    'auto.components.settings.claude-statusline-items-copy.description',
    'Choose which items the managed Claude status line shows. Turning items off frees columns, and the usage bars grow into them. Applies to every Claude account.'
  )
}

type ClaudeStatusLineItemCopy = {
  label: string
  description: string
}

export function getClaudeStatusLineItemCopy(
  key: ClaudeStatusLineItemKey
): ClaudeStatusLineItemCopy {
  switch (key) {
    case 'project':
      return {
        label: translate(
          'auto.components.settings.claude-statusline-items-copy.project',
          'Project'
        ),
        description: translate(
          'auto.components.settings.claude-statusline-items-copy.projectDescription',
          'The workspace directory name, so a pane always says where it is working.'
        )
      }
    case 'model':
      return {
        label: translate('auto.components.settings.claude-statusline-items-copy.model', 'Model'),
        description: translate(
          'auto.components.settings.claude-statusline-items-copy.modelDescription',
          'The active Claude model.'
        )
      }
    case 'context':
      return {
        label: translate(
          'auto.components.settings.claude-statusline-items-copy.context',
          'Context usage'
        ),
        description: translate(
          'auto.components.settings.claude-statusline-items-copy.contextDescription',
          'Context window consumption as a bar with percentage and trend arrow.'
        )
      }
    case 'account':
      return {
        label: translate(
          'auto.components.settings.claude-statusline-items-copy.account',
          'Account'
        ),
        description: translate(
          'auto.components.settings.claude-statusline-items-copy.accountDescription',
          'The signed-in Claude account for the pane (@name).'
        )
      }
    case 'fiveHourQuota':
      return {
        label: translate(
          'auto.components.settings.claude-statusline-items-copy.fiveHour',
          '5-hour quota'
        ),
        description: translate(
          'auto.components.settings.claude-statusline-items-copy.fiveHourDescription',
          'The session rate-limit window as a bar with percentage.'
        )
      }
    case 'sevenDayQuota':
      return {
        label: translate(
          'auto.components.settings.claude-statusline-items-copy.sevenDay',
          'Weekly quota'
        ),
        description: translate(
          'auto.components.settings.claude-statusline-items-copy.sevenDayDescription',
          'The 7-day rate-limit window as a bar with percentage.'
        )
      }
    case 'cost':
      return {
        label: translate(
          'auto.components.settings.claude-statusline-items-copy.cost',
          'Session cost'
        ),
        description: translate(
          'auto.components.settings.claude-statusline-items-copy.costDescription',
          'The API cost the session has accumulated, in USD.'
        )
      }
    case 'resetCountdown':
      return {
        label: translate(
          'auto.components.settings.claude-statusline-items-copy.reset',
          'Reset countdown'
        ),
        description: translate(
          'auto.components.settings.claude-statusline-items-copy.resetDescription',
          'Time remaining until the quota window resets.'
        )
      }
  }
}

export function getClaudeStatusLineSearchKeywords(): string[] {
  return searchKeywords([
    {
      key: 'auto.components.settings.claude-statusline-items-copy.search.statusline',
      fallback: 'status line'
    },
    {
      key: 'auto.components.settings.claude-statusline-items-copy.search.statusline2',
      fallback: 'statusline'
    },
    { key: 'auto.components.settings.claude-statusline-items-copy.search.bar', fallback: 'bar' },
    { key: 'auto.components.settings.claude-statusline-items-copy.search.bars', fallback: 'bars' },
    {
      key: 'auto.components.settings.claude-statusline-items-copy.search.quota',
      fallback: 'quota'
    },
    {
      key: 'auto.components.settings.claude-statusline-items-copy.search.usage',
      fallback: 'usage'
    },
    {
      key: 'auto.components.settings.claude-statusline-items-copy.search.project',
      fallback: 'project'
    },
    { key: 'auto.components.settings.claude-statusline-items-copy.search.cost', fallback: 'cost' },
    {
      key: 'auto.components.settings.claude-statusline-items-copy.search.account',
      fallback: 'account'
    },
    {
      key: 'auto.components.settings.claude-statusline-items-copy.search.reset',
      fallback: 'reset'
    },
    {
      key: 'auto.components.settings.claude-statusline-items-copy.search.claude',
      fallback: 'claude',
      englishOnly: true
    },
    {
      key: 'auto.components.settings.claude-statusline-items-copy.search.ctx',
      fallback: 'ctx',
      englishOnly: true
    }
  ])
}
