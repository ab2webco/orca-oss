import { translate } from '@/i18n/i18n'
import type { WorktreeCardPropertyOption } from './sidebar-workspace-option-items'

// Why off by default: the agent row shows the live action; the hover card holds these (ORCA-1074).
export const AGENT_ROW_PROPERTY_OPTIONS: WorktreeCardPropertyOption[] = [
  {
    id: 'account',
    properties: ['account'],
    get label() {
      return translate('auto.components.sidebar.SidebarWorkspaceOptionsMenu.account', 'Account')
    }
  },
  {
    id: 'model',
    properties: ['model'],
    get label() {
      return translate(
        'auto.components.sidebar.SidebarWorkspaceOptionsMenu.model',
        'Model and effort'
      )
    }
  }
]
