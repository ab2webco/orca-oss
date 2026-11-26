import { translate } from '@/i18n/i18n'
import { teamHostText, teamModelText } from '@/components/team-panel/team-card-text'
import { teamLeadCardLine, teamMemberCardLine } from '@/components/team-panel/team-card-line'
import type { WorktreeCardProperty } from '../../../../shared/types'
import type { SidebarTeamRow } from './sidebar-team-roster'

export type SidebarTeamRowLines = {
  /** V30's act-line; `asks` draws it in the question tone, where the Team card uses its attention tone. */
  activity: { text: string; asks: boolean } | null
  /** V30's second act-line: host, ports, account and model, each when shown. */
  extra: string | null
}

export type SidebarTeamRowLineOptions = {
  teamTabOpen: boolean
  properties: readonly WorktreeCardProperty[]
  /** Not grouped by project, so no host header names the machine above the row. */
  flat: boolean
  ports: readonly number[]
  localHostName: string | null
}

/** What the agent does now, worded and toned as its Team card (ORCA-1366). */
export function sidebarTeamRowActivity(
  row: SidebarTeamRow
): NonNullable<SidebarTeamRowLines['activity']> {
  const line = row.role === 'lead' ? teamLeadCardLine(row.card) : teamMemberCardLine(row.card)
  return { text: line.text, asks: line.attention }
}

function extraOf(
  row: Extract<SidebarTeamRow, { role: 'member' }>,
  options: SidebarTeamRowLineOptions
): string | null {
  const shown = (property: WorktreeCardProperty): boolean => options.properties.includes(property)
  const { card } = row
  const parts = [
    options.flat ? teamHostText(card.host, options.localHostName) : null,
    shown('ports') && options.ports.length > 0
      ? `${translate('teamPanel.activity.ports', 'Ports')} ${options.ports.join(', ')}`
      : null,
    shown('account') && card.account ? `@${card.account.email.split('@')[0]}` : null,
    shown('model') ? teamModelText(card.model) : null
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}

/** The lines under a team row, as V30's drawLeft builds them. */
export function sidebarTeamRowLines(
  row: SidebarTeamRow,
  options: SidebarTeamRowLineOptions
): SidebarTeamRowLines {
  return {
    // Why the tab: with the Team panel open its cards already say what each agent does.
    activity:
      !options.teamTabOpen && options.properties.includes('inline-agents')
        ? sidebarTeamRowActivity(row)
        : null,
    extra: row.role === 'member' ? extraOf(row, options) : null
  }
}
