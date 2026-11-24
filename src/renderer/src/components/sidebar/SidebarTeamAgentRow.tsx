import React from 'react'
import { Crown, GitBranch, GitPullRequest } from 'lucide-react'
import { cn } from '@/lib/utils'
import { branchName } from '@/lib/git-utils'
import { translate } from '@/i18n/i18n'
import { statusToneTextClass } from '@/components/status-tone'
import { TeamStatusMark } from '@/components/team-panel/TeamStatusMark'
import {
  statusToneOfCi,
  teamAgeLabel,
  teamAgeText,
  teamTicketBesideName
} from '@/components/team-panel/team-card-text'
import type { GamePanelLook } from '../../../../shared/orchestrator-game-panel'
import { ticketInText } from '../../../../shared/orchestrator-game-ticket-id'
import type { SidebarTeamRow } from './sidebar-team-roster'
import type { SidebarTeamRowLines } from './sidebar-team-row-lines'

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
  // A roster name never parses as a ticket, so a name that does is the ticket and its title: no character.
  if (!game || (ticket !== null && ticketInText(row.card.name) !== null)) {
    return { name: ticket ?? row.card.name, mono: null }
  }
  return { name: row.card.name, mono: teamTicketBesideName(row.card, true) }
}

/** V30's tree connector from the lead to a child row; -top-0.5 bridges the 2 px of card borders above. */
export const TEAM_CHILD_CONNECTOR_CLASS =
  "before:absolute before:-top-0.5 before:bottom-1/2 before:-left-[13px] before:w-[7px] before:rounded-bl-[5px] before:border-b before:border-l before:border-muted-foreground/40 before:content-['']"

/** V30's sidebar row: state dot, PR or branch icon, bold name, age. */
export const SidebarTeamAgentRow = React.memo(function SidebarTeamAgentRow({
  row,
  look,
  showPr,
  now,
  since,
  child = false,
  lines = null
}: {
  row: SidebarTeamRow
  look: GamePanelLook
  /** Card display's PR/MR link option; off, the row keeps the branch icon. */
  showPr: boolean
  now: number
  since: number | null
  /** Under the lead: V30's `.rw.child`, drawn with the tree connector. */
  child?: boolean
  /** V30's act-lines under the name; none when absent. */
  lines?: SidebarTeamRowLines | null
}): React.JSX.Element {
  const { name, mono } = namePartsOf(row, look === 'game')
  const pr = row.role === 'member' && showPr ? row.card.pr : null
  const ciTone = pr ? statusToneOfCi(pr) : null
  const KindIcon = pr ? GitPullRequest : GitBranch
  const hasLines = Boolean(lines?.activity || lines?.extra)
  const ageLabel = since !== null ? teamAgeLabel(since, now) : undefined
  return (
    <div
      data-sidebar-team-row={row.role}
      data-team-row-child={child ? '' : undefined}
      // Why isolate: the selection fill (main.css `::after`) sits under the row's content.
      className={cn('relative isolate flex w-full min-w-0 flex-col', hasLines && 'pb-1')}
    >
      <div
        className={cn(
          'relative flex h-6.5 w-full min-w-0 items-center gap-[7px] text-[12.5px]',
          child && TEAM_CHILD_CONNECTOR_CLASS
        )}
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
          title={ageLabel}
          aria-label={ageLabel}
          className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
        >
          {since !== null ? teamAgeText(since, now) : null}
        </span>
      </div>
      {/* Why pl-10: V30's act-lines start under the name, past the dot, the icon and their gaps. */}
      {lines?.activity ? (
        <span
          data-team-row-part="act"
          data-asks={lines.activity.asks ? '' : undefined}
          className={cn(
            '-mt-1 truncate pl-10 text-[11.5px] leading-4',
            lines.activity.asks ? 'text-agent-question-text' : 'text-muted-foreground'
          )}
        >
          {lines.activity.text}
        </span>
      ) : null}
      {lines?.extra ? (
        <span
          data-team-row-part="extra"
          className={cn(
            'truncate pl-10 text-[11.5px] leading-4 text-muted-foreground',
            !lines.activity && '-mt-1'
          )}
        >
          {lines.extra}
        </span>
      ) : null}
    </div>
  )
})
