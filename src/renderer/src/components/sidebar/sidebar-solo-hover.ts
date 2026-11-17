import { translate } from '@/i18n/i18n'
import {
  teamCiText,
  teamLiveText,
  teamModelText,
  teamPrNumberText,
  teamSessionStateText
} from '@/components/team-panel/team-card-text'
import type { TeamActivityRow } from '../../../../shared/team-panel-model-types'

export type SidebarSoloHoverLine =
  | { kind: 'text'; label: string; value: string; asks?: boolean }
  | { kind: 'cache'; label: string; expiresAt: number }

export type SidebarSoloHover = {
  title: string
  subtitle: string | null
  lines: SidebarSoloHoverLine[]
}

const text = (label: string, value: string | null, asks = false): SidebarSoloHoverLine[] =>
  value ? [{ kind: 'text', label, value, ...(asks ? { asks } : {}) }] : []

/** V30's hoverHtml for a solo row: who, where, then its state and facts in V30's order. */
export function sidebarSoloHoverOf(row: TeamActivityRow): SidebarSoloHover {
  const primary = translate('auto.components.sidebar.WorktreeCard.7d517f82e2', 'primary')
  const action = row.liveAction
  const question = action?.kind === 'question' ? action.text : null
  const now = action && action.kind !== 'question' ? teamLiveText(action, row.condition) : null
  // Why the local part: the sidebar never prints a full email, and a label like "System default" names none (ORCA-1163).
  const email = row.account?.email
  const account = email?.includes('@') ? email.split('@')[0] : null
  const pr = row.pr
    ? [teamPrNumberText(row.pr), teamCiText(row.pr)].filter(Boolean).join(' · ')
    : null
  return {
    title: row.isPrimary ? `${row.worktreeName} · ${primary}` : row.worktreeName,
    subtitle:
      [row.repoName, row.host.kind === 'remote' ? row.host.name : null]
        .filter(Boolean)
        .join(' · ') || null,
    lines: [
      ...text(
        translate('teamPanel.activity.state', 'State'),
        teamSessionStateText(row.condition),
        row.status === 'attention'
      ),
      ...text(translate('teamPanel.activity.prompt', 'Prompt'), row.prompt),
      ...text(translate('teamPanel.activity.now', 'Now'), now),
      ...text(translate('teamPanel.activity.question', 'Question'), question, true),
      ...text(translate('teamPanel.activity.model', 'Model'), teamModelText(row.model)),
      ...text(translate('teamPanel.activity.account', 'Account'), account),
      ...(row.cacheExpiresAt !== null
        ? [
            {
              kind: 'cache' as const,
              label: translate('teamPanel.activity.cache', 'Cache'),
              expiresAt: row.cacheExpiresAt
            }
          ]
        : []),
      ...text(translate('teamPanel.activity.pr', 'PR'), pr),
      ...text(translate('teamPanel.activity.ticket', 'Ticket'), row.ticket?.identifier ?? null),
      ...text(
        translate('teamPanel.activity.ports', 'Ports'),
        row.ports.length > 0 ? row.ports.join(', ') : null
      ),
      ...text(translate('teamPanel.activity.notes', 'Notes'), row.note)
    ]
  }
}
