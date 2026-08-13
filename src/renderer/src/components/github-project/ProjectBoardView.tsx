import React, { useMemo } from 'react'
import { ArrowRight, ExternalLink, FileText, GitPullRequest, Lock } from 'lucide-react'

import { TaskBoard, type TaskBoardColumn } from '@/components/task-board'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { buildGitHubProjectBoardColumns } from '../../../../shared/github-project-board-columns'
import type { GitHubProjectRow, GitHubProjectTable } from '../../../../shared/github-project-types'

type Props = {
  table: GitHubProjectTable
  onOpenDialog?: (row: GitHubProjectRow) => void
  onStartWork?: (row: GitHubProjectRow) => void
  onOpenInBrowser?: (row: GitHubProjectRow) => void
}

function ProjectBoardCard({
  onOpenDialog,
  onOpenInBrowser,
  onStartWork,
  row
}: {
  onOpenDialog?: (row: GitHubProjectRow) => void
  onOpenInBrowser?: (row: GitHubProjectRow) => void
  onStartWork?: (row: GitHubProjectRow) => void
  row: GitHubProjectRow
}): React.JSX.Element {
  const itemLabel =
    row.itemType === 'REDACTED'
      ? translate(
          'auto.components.github.project.ProjectBoardView.restrictedItem',
          'Restricted item'
        )
      : row.content.repository && row.content.number != null
        ? `${row.content.repository}#${row.content.number}`
        : translate('auto.components.github.project.ProjectBoardView.draftItem', 'Draft item')
  const ItemIcon =
    row.itemType === 'PULL_REQUEST' ? GitPullRequest : row.itemType === 'REDACTED' ? Lock : FileText
  const canStartWork =
    row.itemType !== 'REDACTED' && row.itemType !== 'DRAFT_ISSUE' && row.content.number != null

  return (
    <div
      data-github-project-board-card
      draggable={false}
      aria-disabled={row.itemType === 'REDACTED' ? 'true' : undefined}
      className={cn(
        'group/row rounded-md border border-border/50 bg-background px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        canStartWork ? 'cursor-pointer' : 'cursor-default opacity-60'
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <button
          type="button"
          disabled={!canStartWork}
          className="min-w-0 text-left"
          onClick={() => onOpenDialog?.(row)}
        >
          <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <ItemIcon className="size-3.5 shrink-0" />
            <span className="truncate">{itemLabel}</span>
          </div>
          <h3 className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {row.content.title || itemLabel}
          </h3>
        </button>
        <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          {canStartWork ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(event) => {
                    event.stopPropagation()
                    onStartWork?.(row)
                  }}
                  aria-label={translate(
                    'auto.components.github.project.ProjectBoardView.startWork',
                    'Start work'
                  )}
                >
                  <ArrowRight className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {translate(
                  'auto.components.github.project.ProjectBoardView.startWork',
                  'Start work'
                )}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {row.content.url ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpenInBrowser?.(row)
                  }}
                  aria-label={translate(
                    'auto.components.github.project.ProjectBoardView.openInGitHub',
                    'Open in GitHub'
                  )}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {translate(
                  'auto.components.github.project.ProjectBoardView.openInGitHub',
                  'Open in GitHub'
                )}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {row.content.assignees.length > 0 || row.content.labels.length > 0 ? (
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          {row.content.assignees[0] ? (
            <span className="truncate">@{row.content.assignees[0].login}</span>
          ) : null}
          {row.content.labels.slice(0, 2).map((label) => (
            <span
              key={label.name}
              className="max-w-[120px] truncate rounded-full border border-border/50 bg-muted/35 px-1.5 py-0.5"
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function ProjectBoardView({
  table,
  onOpenDialog,
  onOpenInBrowser,
  onStartWork
}: Props): React.JSX.Element {
  const columns = useMemo<TaskBoardColumn<GitHubProjectRow>[]>(
    () =>
      buildGitHubProjectBoardColumns(table).map((column) => ({
        key: column.key,
        label: column.label,
        issues: column.rows
      })),
    [table]
  )

  return (
    <TaskBoard
      columns={columns}
      dragDisabledReason={translate(
        'auto.components.github.project.ProjectBoardView.readOnlyReason',
        'This board is read-only. Drag-and-drop updates are unavailable.'
      )}
      renderCard={(row) => (
        <ProjectBoardCard
          key={row.id}
          row={row}
          onOpenDialog={onOpenDialog}
          onOpenInBrowser={onOpenInBrowser}
          onStartWork={onStartWork}
        />
      )}
    />
  )
}
