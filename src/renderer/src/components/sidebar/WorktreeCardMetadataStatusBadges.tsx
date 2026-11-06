import React from 'react'
import { Badge } from '@/components/ui/badge'
import { CircleCheck, CircleDot, CircleX, Clock, GitMerge } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PullRequestIcon, checksLabel } from './WorktreeCardHelpers'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'
import type { IssueInfo } from '../../../../shared/github/pull-request-types'
import { translate } from '@/i18n/i18n'
import { statusToneBadgeClass } from '@/components/status-tone'
import { checkStatusTone } from '@/components/review-status-tone'

function MetadataStatusBadge({
  label,
  children,
  className
}: {
  label: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-4 gap-1 rounded px-1.5 text-[9px] font-medium leading-none [&>svg]:size-2.5',
        className
      )}
    >
      {children}
      <span>{label}</span>
    </Badge>
  )
}

export function IssueStateBadge({ state }: { state: IssueInfo['state'] }): React.JSX.Element {
  if (state === 'closed') {
    return (
      <MetadataStatusBadge
        label={translate(
          'auto.components.sidebar.WorktreeCardMetadataStatusBadges.e888362def',
          'State: Closed'
        )}
        className={statusToneBadgeClass('success')}
      >
        <CircleCheck />
      </MetadataStatusBadge>
    )
  }

  return (
    <MetadataStatusBadge
      label={translate(
        'auto.components.sidebar.WorktreeCardMetadataStatusBadges.fe188062a1',
        'State: Open'
      )}
      className={statusToneBadgeClass('info')}
    >
      <CircleDot />
    </MetadataStatusBadge>
  )
}

export function LinearStateBadge({ stateName }: { stateName: string }): React.JSX.Element {
  const normalized = stateName.toLowerCase()
  const done = /done|closed|complete|completed|merged|resolved/.test(normalized)
  const cancelled = /cancel|canceled|duplicate|wontfix/.test(normalized)
  const active = /progress|doing|started|active/.test(normalized)
  const Icon = done ? CircleCheck : cancelled ? CircleX : active ? Clock : CircleDot
  // Why: cancelled is a decision, not a failure, so it stays idle rather than red.
  const tone = done
    ? statusToneBadgeClass('success')
    : cancelled
      ? statusToneBadgeClass('idle')
      : active
        ? statusToneBadgeClass('info')
        : 'border-border bg-muted/30 text-muted-foreground'

  return (
    <MetadataStatusBadge
      label={translate(
        'auto.components.sidebar.WorktreeCardMetadataStatusBadges.af2b07bda5',
        'State: {{value0}}',
        { value0: stateName }
      )}
      className={tone}
    >
      <Icon />
    </MetadataStatusBadge>
  )
}

export function ReviewStateBadge({
  state,
  label
}: {
  state: WorktreeCardPrDisplay['state']
  label: 'MR' | 'PR'
}): React.JSX.Element | null {
  if (!state) {
    return null
  }

  if (state === 'merged') {
    return (
      <MetadataStatusBadge
        label={translate(
          'auto.components.sidebar.WorktreeCardMetadataStatusBadges.f394b3e86e',
          'State: Merged'
        )}
        className={statusToneBadgeClass('success')}
      >
        <GitMerge />
      </MetadataStatusBadge>
    )
  }

  if (state === 'closed') {
    return (
      <MetadataStatusBadge
        label={translate(
          'auto.components.sidebar.WorktreeCardMetadataStatusBadges.e888362def',
          'State: Closed'
        )}
        className={statusToneBadgeClass('idle')}
      >
        <CircleX />
      </MetadataStatusBadge>
    )
  }

  if (state === 'draft') {
    return (
      <MetadataStatusBadge
        label={translate(
          'auto.components.sidebar.WorktreeCardMetadataStatusBadges.2931b42b09',
          'State: Draft {{value0}}',
          { value0: label }
        )}
        className="border-border bg-muted/30 text-muted-foreground"
      >
        <CircleDot />
      </MetadataStatusBadge>
    )
  }

  return (
    <MetadataStatusBadge
      label={translate(
        'auto.components.sidebar.WorktreeCardMetadataStatusBadges.fe188062a1',
        'State: Open'
      )}
      className={statusToneBadgeClass('info')}
    >
      {label === 'MR' ? <GitMerge /> : <PullRequestIcon />}
    </MetadataStatusBadge>
  )
}

export function ReviewChecksBadge({
  status
}: {
  status: WorktreeCardPrDisplay['status']
}): React.JSX.Element | null {
  if (!status || status === 'neutral') {
    return null
  }

  const label = `Checks: ${checksLabel(status)}`

  if (status === 'success') {
    return (
      <MetadataStatusBadge label={label} className={statusToneBadgeClass(checkStatusTone(status))}>
        <CircleCheck />
      </MetadataStatusBadge>
    )
  }

  if (status === 'failure') {
    return (
      <MetadataStatusBadge label={label} className={statusToneBadgeClass(checkStatusTone(status))}>
        <CircleX />
      </MetadataStatusBadge>
    )
  }

  return (
    <MetadataStatusBadge label={label} className={statusToneBadgeClass(checkStatusTone(status))}>
      <Clock />
    </MetadataStatusBadge>
  )
}
