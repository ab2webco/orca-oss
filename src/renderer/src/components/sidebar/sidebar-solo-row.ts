import { translate } from '@/i18n/i18n'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { teamModelText } from '@/components/team-panel/team-card-text'
import { teamActivityLine } from '@/components/team-panel/team-panel-activity-tab'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { teamActivityRowOf } from '../../../../shared/team-panel-activity-rows'
import type { TeamActivityRow } from '../../../../shared/team-panel-model-types'
import type { WorktreeCardProperty } from '../../../../shared/types'
import type { SidebarTeamRowLines } from './sidebar-team-row-lines'

export type SidebarSoloAgent = { agent: DashboardAgentRow; subagents: number }

/** V30's soloRow is a one-agent row: a card with no live agent, or with two, stays as it is. */
export function sidebarSoloAgentOf(agents: readonly DashboardAgentRow[]): SidebarSoloAgent | null {
  const panes = agents.filter((one) => one.rowSource !== 'subagent')
  if (panes.length !== 1 || panes[0].rowSource === 'retained') {
    return null
  }
  return { agent: panes[0], subagents: agents.length - 1 }
}

export type SidebarSoloRowLineOptions = {
  properties: readonly WorktreeCardProperty[]
  /** Not grouped by project, so no repo header names the project above the row. */
  flat: boolean
  repoName: string
  /** The remote host's name; null on this machine, where V30 names none. */
  remoteHost: string | null
  subagents: number
  ports: readonly number[]
  /** The account label the worktree resolves to; only an email is shown. */
  account: string | null
}

/** The entry as the Activity tab reads it: status, question, tool, last reply and prompt. */
export function sidebarSoloActivityRow(entry: AgentStatusEntry): TeamActivityRow {
  return teamActivityRowOf({
    entry,
    repoName: '',
    worktreeName: '',
    worktreeId: entry.worktreeId ?? null,
    isPrimary: false,
    inTeam: false,
    host: { kind: 'local' },
    ticket: null,
    pr: null,
    note: null,
    ports: [],
    account: null,
    cacheExpiresAt: null,
    advisor: null
  })
}

function subagentText(count: number): string {
  return count === 1
    ? translate('dashboardPopout.card.subagents_one', '{{count}} subagent', { count })
    : translate('dashboardPopout.card.subagents_other', '{{count}} subagents', { count })
}

/** The lines under a solo row, as V30's soloRow builds them. */
export function sidebarSoloRowLines(
  entry: AgentStatusEntry,
  options: SidebarSoloRowLineOptions
): SidebarTeamRowLines {
  const shown = (property: WorktreeCardProperty): boolean => options.properties.includes(property)
  const row = sidebarSoloActivityRow(entry)
  // Why the email check: a "System default" label names no account (ORCA-1163).
  const account = options.account?.includes('@') ? options.account.split('@')[0] : null
  const parts = [
    options.flat ? options.repoName : null,
    options.remoteHost,
    options.subagents > 0 ? subagentText(options.subagents) : null,
    shown('ports') && options.ports.length > 0
      ? `${translate('teamPanel.activity.ports', 'Ports')} ${options.ports.join(', ')}`
      : null,
    shown('account') && account ? `@${account}` : null,
    shown('model') ? teamModelText(row.model) : null
  ].filter((part): part is string => Boolean(part))
  return {
    activity: shown('inline-agents')
      ? { text: teamActivityLine(row), asks: row.status === 'attention' }
      : null,
    extra: parts.length > 0 ? parts.join(' · ') : null
  }
}
