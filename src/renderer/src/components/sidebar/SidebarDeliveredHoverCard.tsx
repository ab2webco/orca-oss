import React from 'react'
import { cn } from '@/lib/utils'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useNow } from '@/components/dashboard/useNow'
import { statusToneTextClass } from '@/components/status-tone'
import { alsoWorkedOn, type AlsoWorkedOn } from './sidebar-delivered-members'
import { useSidebarDeliveredStore } from './sidebar-delivered-store'
import { useSidebarTeamRosterStore } from './sidebar-team-roster'
import { DeliveredKindIcon } from './SidebarDeliveredRow'
import type { DeliveredView } from './use-sidebar-delivered-view'
import {
  deliveredAlso,
  deliveredDoneBy,
  deliveredFreedValue,
  deliveredHoverLabel,
  deliveredPrValue
} from './sidebar-delivered-words'
import { WORKTREE_NATIVE_CONTEXT_MENU_ATTR } from './WorktreeContextMenu'
import { SIDEBAR_HOVER_CARD_OFFSET, sidebarHoverCardSide } from './sidebar-hover-card-side'

const CARD_WIDTH = 320

function Field({
  name,
  value,
  className
}: {
  name: 'pr' | 'title' | 'branch' | 'lead' | 'freed'
  value: string
  className?: string
}): React.JSX.Element {
  return (
    <div data-delivered-field={name} className="contents">
      <dt className="text-muted-foreground">{deliveredHoverLabel(name)}</dt>
      <dd className={cn('min-w-0 truncate text-foreground', className)}>{value}</dd>
    </div>
  )
}

/** The hover card's body: who did the ticket, its PR, and when its worktree was freed. */
export function SidebarDeliveredHoverDetails({
  view,
  leadName,
  projectName,
  others,
  now
}: {
  view: DeliveredView
  leadName: string | null
  projectName: string | null
  others: readonly AlsoWorkedOn[]
  now: number
}): React.JSX.Element {
  const { member, pr, kind } = view
  const character = member.character
  const lead = [leadName, projectName].filter(Boolean).join(' · ')
  const prTone =
    kind === 'merged'
      ? statusToneTextClass('success')
      : kind === 'ciFailing'
        ? statusToneTextClass('warning')
        : undefined
  return (
    <div className="space-y-2">
      <div data-delivered-hover-header="" className="flex min-w-0 items-center gap-1.5">
        <DeliveredKindIcon view={view} />
        <span className="font-mono font-semibold text-foreground">
          {member.ticket ?? member.branch ?? member.worktreeId}
        </span>
        {character ? (
          <span className="truncate text-muted-foreground">· {deliveredDoneBy(character)}</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <Field name="pr" value={deliveredPrValue(pr, kind)} className={prTone} />
        {pr?.title ? <Field name="title" value={pr.title} /> : null}
        {member.branch ? <Field name="branch" value={member.branch} /> : null}
        {lead ? <Field name="lead" value={lead} /> : null}
        <Field name="freed" value={deliveredFreedValue(member.freedAt, now)} />
      </dl>
      {character && others.length > 0 ? (
        <p data-delivered-also="" className="border-t border-border pt-2 text-muted-foreground">
          {deliveredAlso(character, others)}
        </p>
      ) : null}
    </div>
  )
}

/** The freed row's hover card, in the sidebar's hover card pattern (WorktreeCardDetailsHover). */
export function SidebarDeliveredHoverCard({
  view,
  children
}: {
  view: DeliveredView
  children: React.ReactElement
}): React.JSX.Element {
  const lead = useSidebarTeamRosterStore((s) => s.model?.lead ?? null)
  const members = useSidebarTeamRosterStore((s) => s.model?.members ?? null)
  const projectName = useSidebarDeliveredStore((s) => s.projectName)
  const history = useSidebarDeliveredStore((s) => s.history)
  const now = useNow(30_000)
  const others = React.useMemo(
    () =>
      alsoWorkedOn({
        character: view.member.character,
        ticket: view.member.ticket,
        records: history,
        liveMembers: (members ?? []).map((one) => ({
          name: one.name,
          ticket: one.ticket?.identifier ?? null
        }))
      }),
    [view.member.character, view.member.ticket, history, members]
  )
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
        // Why the cap: at 320 px the card is as wide as the window.
        className="w-80 max-w-[calc(100vw-16px)] p-3 text-xs"
        data-sidebar-delivered-hover=""
        {...{ [WORKTREE_NATIVE_CONTEXT_MENU_ATTR]: '' }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <SidebarDeliveredHoverDetails
          view={view}
          leadName={lead?.name ?? null}
          projectName={projectName}
          others={others}
          now={now}
        />
      </HoverCardContent>
    </HoverCard>
  )
}
