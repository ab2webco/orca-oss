import React from 'react'
import { Crown, GitBranch, GitPullRequest } from 'lucide-react'
import { cn } from '@/lib/utils'
import { branchName } from '@/lib/git-utils'
import { translate } from '@/i18n/i18n'
import { statusToneTextClass } from '@/components/status-tone'
import { TeamStatusMark } from '@/components/team-panel/TeamStatusMark'
import {
  statusToneOfCi,
  teamAgeText,
  teamTicketBesideName
} from '@/components/team-panel/team-card-text'
import type { GamePanelLook } from '../../../../shared/orchestrator-game-panel'
import type { SidebarTeamRow } from './sidebar-team-roster'

type NameParts = { name: string; mono: string | null }

function namePartsOf(row: SidebarTeamRow, game: boolean): NameParts {
  if (row.role === 'lead') {
    return {
      name: game ? row.card.name : translate('teamPanel.lead.badge', 'Lead'),
      mono: row.card.branch ? branchName(row.card.branch) : null
    }
  }
  const ticket = row.card.ticket?.identifier ?? null
  // Why: plain mode names a member by its ticket; game mode by its character, with the ticket beside it.
  if (!game) {
    return { name: ticket ?? row.card.name, mono: null }
  }
  return { name: row.card.name, mono: teamTicketBesideName(row.card, true) }
}

/** V30's sidebar row: state dot, PR or branch icon, bold name, age. */
export const SidebarTeamAgentRow = React.memo(function SidebarTeamAgentRow({
  row,
  look,
  showPr,
  now
}: {
  row: SidebarTeamRow
  look: GamePanelLook
  /** Card display's PR/MR link option; off, the row keeps the branch icon. */
  showPr: boolean
  now: number
}): React.JSX.Element {
  const { name, mono } = namePartsOf(row, look === 'game')
  const pr = row.role === 'member' && showPr ? row.card.pr : null
  const ciTone = pr ? statusToneOfCi(pr) : null
  const KindIcon = pr ? GitPullRequest : GitBranch
  const since = row.card.since
  return (
    <div
      data-sidebar-team-row={row.role}
      className="flex h-6 w-full min-w-0 items-center gap-[7px] text-[12.5px]"
    >
      <span data-team-row-part="state" className="grid w-3.5 shrink-0 place-items-center">
        <TeamStatusMark status={row.card.status} />
      </span>
      <span
        data-team-row-part="kind"
        data-kind={pr ? 'pr' : 'branch'}
        data-ci-tone={ciTone ?? undefined}
        className={cn(
          'grid shrink-0 place-items-center',
          ciTone ? statusToneTextClass(ciTone) : 'text-muted-foreground'
        )}
      >
        <KindIcon className="size-3" aria-hidden="true" />
      </span>
      <span data-team-row-part="name" className="flex min-w-0 flex-1 items-center truncate">
        {row.role === 'lead' ? (
          <Crown
            data-game-lead-crown=""
            className="mr-[5px] size-3 shrink-0 text-foreground"
            aria-label={translate('teamPanel.lead.badge', 'Lead')}
          />
        ) : null}
        <b className="truncate font-medium text-foreground">{name}</b>
        {mono ? (
          <span
            data-team-row-ticket=""
            className="ml-1.5 shrink-0 font-mono text-[11.5px] text-muted-foreground"
          >
            {mono}
          </span>
        ) : null}
      </span>
      <span
        data-team-row-part="age"
        className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
      >
        {since !== null ? teamAgeText(since, now) : null}
      </span>
    </div>
  )
})
