import React, { useMemo } from 'react'
import { ArrowRight, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { JiraIssue, JiraProjectStatusOrder } from '../../../shared/types'
import { TaskBoard } from './task-board'
import { groupJiraIssuesByStatus, isSelectedJiraIssue } from './task-page-jira-issue-list'

type TaskPageJiraBoardProps = {
  formatUpdatedAt: (updatedAt: string) => string
  getStatusTone: (categoryKey: string) => string
  issues: JiraIssue[]
  onOpenIssue: (issue: JiraIssue) => void
  onStartWorkspace: (issue: JiraIssue) => void
  selectedIssue: JiraIssue | null
  showSiteContext: boolean
  statusOrder: JiraProjectStatusOrder | null
}

function JiraBoardCard({
  formatUpdatedAt,
  getStatusTone,
  issue,
  onOpenIssue,
  onStartWorkspace,
  selected,
  showSiteContext
}: Omit<TaskPageJiraBoardProps, 'issues' | 'selectedIssue' | 'statusDirection' | 'statusOrder'> & {
  issue: JiraIssue
  selected: boolean
}): React.JSX.Element {
  const labels = issue.labels.slice(0, 2)
  const contextLabel =
    showSiteContext && issue.siteName
      ? `${issue.siteName} / ${issue.project.key}`
      : issue.project.key

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={false}
      aria-current={selected ? 'true' : undefined}
      data-current={selected ? 'true' : undefined}
      onClick={() => onOpenIssue(issue)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenIssue(issue)
        }
      }}
      className={cn(
        'group/row cursor-pointer rounded-md border border-border/50 bg-background px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected && 'bg-accent'
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="truncate">{issue.key}</span>
            <span className="truncate">{issue.priority?.name}</span>
          </div>
          <h3 className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {issue.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(event) => {
                  event.stopPropagation()
                  onStartWorkspace(issue)
                }}
                aria-label={translate(
                  'auto.components.TaskPage.ff90d0abc7',
                  'Start workspace from {{value0}}',
                  { value0: issue.key }
                )}
              >
                <ArrowRight className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.TaskPage.9497f2787c', 'Start workspace')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(event) => {
                  event.stopPropagation()
                  window.api.shell.openUrl(issue.url)
                }}
                aria-label={translate(
                  'auto.components.TaskPage.4ac8ff2275',
                  'Open {{value0}} in Jira',
                  { value0: issue.key }
                )}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.TaskPage.eee68073b2', 'Open in Jira')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className={cn(
            'inline-flex min-w-0 items-center rounded-full border px-1.5 py-0.5 font-medium',
            getStatusTone(issue.status.categoryKey)
          )}
        >
          <span className="truncate">{issue.status.name}</span>
        </span>
        <span className="min-w-0 truncate">
          {issue.assignee?.displayName ??
            translate('auto.components.TaskPage.42a9160321', 'Unassigned')}
        </span>
        <span className="ml-auto shrink-0">{formatUpdatedAt(issue.updatedAt)}</span>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
        <span className="max-w-[140px] truncate text-[10px] text-muted-foreground">
          {contextLabel}
        </span>
        {labels.map((label) => (
          <span
            key={label}
            className="max-w-[140px] truncate rounded-full border border-border/50 bg-muted/35 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {label}
          </span>
        ))}
        {issue.labels.length > labels.length ? (
          <span className="text-[10px] text-muted-foreground">
            +{issue.labels.length - labels.length}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function TaskPageJiraBoard({
  formatUpdatedAt,
  getStatusTone,
  issues,
  onOpenIssue,
  onStartWorkspace,
  selectedIssue,
  showSiteContext,
  statusOrder
}: TaskPageJiraBoardProps): React.JSX.Element {
  const columns = useMemo(() => groupJiraIssuesByStatus(issues, statusOrder), [issues, statusOrder])

  return (
    <TaskBoard
      columns={columns}
      dragDisabledReason={translate(
        'auto.components.TaskPage.jiraBoardDragDisabled',
        'Drag is unavailable because Jira status changes require valid workflow transitions.'
      )}
      renderCard={(issue) => (
        <JiraBoardCard
          key={`${issue.siteId ?? 'site'}:${issue.id || issue.key}`}
          formatUpdatedAt={formatUpdatedAt}
          getStatusTone={getStatusTone}
          issue={issue}
          onOpenIssue={onOpenIssue}
          onStartWorkspace={onStartWorkspace}
          selected={isSelectedJiraIssue(issue, selectedIssue)}
          showSiteContext={showSiteContext}
        />
      )}
    />
  )
}
