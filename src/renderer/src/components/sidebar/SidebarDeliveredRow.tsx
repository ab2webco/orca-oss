import React from 'react'
import { GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusDot } from '@/components/StatusDot'
import { statusToneTextClass } from '@/components/status-tone'
import { teamAgeText } from '@/components/team-panel/team-card-text'
import { TEAM_CHILD_CONNECTOR_CLASS } from './SidebarTeamAgentRow'
import type { DeliveredPrKind } from './sidebar-delivered-members'
import type { DeliveredView } from './use-sidebar-delivered-view'
import { deliveredPrLine, deliveredTone } from './sidebar-delivered-words'

const ICONS = {
  merged: { Icon: GitMerge, name: 'merge' },
  open: { Icon: GitPullRequest, name: 'pr' },
  ciFailing: { Icon: GitPullRequest, name: 'pr' },
  closed: { Icon: GitPullRequestClosed, name: 'closed' },
  none: { Icon: GitBranch, name: 'branch' }
} as const

/** The PR icon's colour: green once merged or green CI, amber on a failure, muted otherwise. */
export function deliveredIconClass(view: Pick<DeliveredView, 'kind' | 'pr'>): string {
  if (view.kind === 'merged' || (view.kind === 'open' && view.pr?.ci === 'success')) {
    return statusToneTextClass('success')
  }
  return view.kind === 'ciFailing' ? statusToneTextClass('warning') : 'text-muted-foreground'
}

export function DeliveredKindIcon({
  view,
  className
}: {
  view: Pick<DeliveredView, 'kind' | 'pr'>
  className?: string
}): React.JSX.Element {
  const { Icon, name } = ICONS[view.kind]
  return (
    <Icon
      data-delivered-icon={name}
      className={cn('size-3 shrink-0', deliveredIconClass(view), className)}
      aria-hidden="true"
    />
  )
}

const LINE_TONE: Record<DeliveredPrKind, string> = {
  merged: statusToneTextClass('success'),
  ciFailing: statusToneTextClass('warning'),
  open: 'text-muted-foreground',
  closed: 'text-muted-foreground',
  none: 'text-muted-foreground'
}

/** A freed member under its lead: ticket and age, then its PR number and state (ORCA-1216 §6). */
export const SidebarDeliveredRow = React.memo(function SidebarDeliveredRow({
  view,
  now
}: {
  view: DeliveredView
  now: number
}): React.JSX.Element {
  const { member, pr, kind } = view
  return (
    <div
      data-sidebar-team-row="delivered"
      data-team-row-child=""
      className="relative isolate flex w-full min-w-0 flex-col pb-1"
    >
      <div
        className={cn(
          'relative flex h-6.5 w-full min-w-0 items-center gap-[7px] text-[12.5px]',
          TEAM_CHILD_CONNECTOR_CLASS
        )}
      >
        <span data-team-row-part="state" className="grid w-3.5 shrink-0 place-items-center">
          <StatusDot tone={deliveredTone(kind)} />
        </span>
        <span data-team-row-part="kind" className="grid shrink-0 place-items-center">
          <DeliveredKindIcon view={view} />
        </span>
        <span data-team-row-part="name" className="flex min-w-0 flex-1 items-center truncate">
          <b className="truncate font-medium text-foreground">
            {member.ticket ?? member.branch ?? member.worktreeId}
          </b>
        </span>
        <span
          data-team-row-part="age"
          className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
        >
          {teamAgeText(member.freedAt, now)}
        </span>
      </div>
      <span
        data-delivered-pr-line=""
        data-delivered-kind={kind}
        className={cn('-mt-1 truncate pl-10 text-[11.5px] leading-4', LINE_TONE[kind])}
      >
        {deliveredPrLine(pr, kind)}
      </span>
    </div>
  )
})
