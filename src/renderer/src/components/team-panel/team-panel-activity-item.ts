import { User, Users } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { TeamPanelModel } from '../../../../shared/team-panel-model-types'
import type { ActivityBarItem } from '../right-sidebar/activity-bar-buttons'

/** A single agent or separate sessions are not a team: one avatar, not the group icon. */
export function teamPanelActivityItem(kind: TeamPanelModel['kind'] | null): ActivityBarItem {
  return kind === 'solo'
    ? {
        id: 'team',
        icon: User,
        title: translate('teamPanel.activityBar.noTeamTitle', 'Your work'),
        shortcut: ''
      }
    : {
        id: 'team',
        icon: Users,
        title: translate('teamPanel.activityBar.teamTitle', 'Team'),
        shortcut: ''
      }
}
