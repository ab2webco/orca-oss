import React from 'react'
import { cn } from '@/lib/utils'
import { useLocalHostName } from '@/lib/use-local-host-name'
import { branchName } from '@/lib/git-utils'
import { translate } from '@/i18n/i18n'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import {
  teamCiText,
  teamHostText,
  teamModelText,
  teamPrNumberText,
  teamTicketBesideName
} from '@/components/team-panel/team-card-text'
import type { GamePanelLook } from '../../../../shared/orchestrator-game-panel'
import { useSidebarTeamLook, type SidebarTeamRow } from './sidebar-team-roster'
import { sidebarTeamRowActivity } from './sidebar-team-row-lines'
import { WORKTREE_NATIVE_CONTEXT_MENU_ATTR } from './WorktreeContextMenu'
import { SIDEBAR_HOVER_CARD_OFFSET, sidebarHoverCardSide } from './sidebar-hover-card-side'

const CARD_WIDTH = 288

type HoverLine = { label: string; value: string | null; asks?: boolean }

function headOf(
  row: SidebarTeamRow,
  game: boolean,
  repoName: string | null,
  localHostName: string | null
): { title: string; subtitle: string | null } {
  const host = teamHostText(row.card.host, localHostName)
  if (row.role === 'lead') {
    const name = game ? row.card.name : translate('teamPanel.lead.badge', 'Lead')
    const branch = row.card.branch ? branchName(row.card.branch) : null
    return {
      title: [name, branch].filter(Boolean).join(' · '),
      subtitle: [repoName, host].filter(Boolean).join(' · ')
    }
  }
  const ticket = row.card.ticket?.identifier ?? null
  const title = game
    ? [row.card.name, teamTicketBesideName(row.card, true)].filter(Boolean).join(' · ')
    : (ticket ?? row.card.name)
  return { title, subtitle: row.card.ticket?.title ?? null }
}

function linesOf(row: SidebarTeamRow, localHostName: string | null): HoverLine[] {
  const now = sidebarTeamRowActivity(row)
  const lines: HoverLine[] = [
    { label: translate('teamPanel.activity.now', 'Now'), value: now.text, asks: now.asks },
    { label: translate('teamPanel.activity.model', 'Model'), value: teamModelText(row.card.model) },
    {
      label: translate('teamPanel.activity.account', 'Account'),
      value: row.card.account?.email ?? null
    }
  ]
  if (row.role === 'member') {
    const { pr } = row.card
    lines.push(
      {
        label: translate('teamPanel.activity.pr', 'PR'),
        value: pr ? [teamPrNumberText(pr), teamCiText(pr)].filter(Boolean).join(' · ') : null
      },
      {
        label: translate('teamPanel.activity.host', 'Host'),
        value: teamHostText(row.card.host, localHostName)
      }
    )
  }
  return lines
}

/** V30's hoverHtml for a member or the lead: who, on what, then what it does and where. */
export function SidebarTeamHoverDetails({
  row,
  look,
  repoName,
  localHostName
}: {
  row: SidebarTeamRow
  look: GamePanelLook
  repoName: string | null
  localHostName: string | null
}): React.JSX.Element {
  const { title, subtitle } = headOf(row, look === 'game', repoName, localHostName)
  return (
    <div data-sidebar-team-hover={row.role} className="min-w-0">
      <h5 data-team-hover-title="" className="m-0 text-[13px] font-semibold text-foreground">
        {title}
      </h5>
      {subtitle ? (
        <p data-team-hover-subtitle="" className="m-0 mt-0.5 text-muted-foreground">
          {subtitle}
        </p>
      ) : null}
      <dl className="m-0 mt-2.5 grid grid-cols-[62px_minmax(0,1fr)] gap-x-2.5 gap-y-1">
        {linesOf(row, localHostName)
          .filter((line) => line.value)
          .map((line) => (
            <React.Fragment key={line.label}>
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd
                data-asks={line.asks ? '' : undefined}
                className={cn(
                  'm-0 [overflow-wrap:anywhere]',
                  line.asks && 'text-agent-question-text'
                )}
              >
                {line.value}
              </dd>
            </React.Fragment>
          ))}
      </dl>
    </div>
  )
}

/** Pointing at a team row opens its V30 card in place of the worktree's details. */
export function SidebarTeamHoverCard({
  row,
  repoName,
  children
}: {
  row: SidebarTeamRow
  repoName: string | null
  children: React.ReactElement
}): React.JSX.Element {
  const look = useSidebarTeamLook()
  const localHostName = useLocalHostName()
  const [side, setSide] = React.useState<'right' | 'bottom'>('right')
  // Why on enter: the side must be known before the open delay ends and the card is placed.
  const placeFrom = (trigger: Element): void =>
    setSide(
      sidebarHoverCardSide({
        triggerRight: trigger.getBoundingClientRect().right,
        viewportWidth: window.innerWidth,
        cardWidth: CARD_WIDTH
      })
    )
  return (
    <HoverCard openDelay={100} closeDelay={120}>
      <HoverCardTrigger
        asChild
        onPointerEnter={(event) => placeFrom(event.currentTarget)}
        onFocus={(event) => placeFrom(event.currentTarget)}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align="start"
        sideOffset={SIDEBAR_HOVER_CARD_OFFSET}
        collisionPadding={8}
        className="w-72 p-3 text-xs"
        {...{ [WORKTREE_NATIVE_CONTEXT_MENU_ATTR]: '' }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <SidebarTeamHoverDetails
          row={row}
          look={look}
          repoName={repoName}
          localHostName={localHostName}
        />
      </HoverCardContent>
    </HoverCard>
  )
}
