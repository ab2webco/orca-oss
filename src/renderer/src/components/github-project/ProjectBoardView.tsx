import React, { useMemo, useRef, useState } from 'react'
import { ArrowRight, ExternalLink, FileText, GitPullRequest, Lock } from 'lucide-react'

import { TaskBoard, type TaskBoardColumn } from '@/components/task-board'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  buildGitHubProjectBoardColumns,
  resolveGitHubProjectBoardGroupField
} from '../../../../shared/github-project-board-columns'
import type {
  GitHubProjectFieldMutationValue,
  GitHubProjectRow,
  GitHubProjectTable
} from '../../../../shared/github-project-types'

type Props = {
  table: GitHubProjectTable
  onOpenDialog?: (row: GitHubProjectRow) => void
  onEditField?: (
    row: GitHubProjectRow,
    fieldId: string,
    value: GitHubProjectFieldMutationValue | null
  ) => Promise<void> | void
  onStartWork?: (row: GitHubProjectRow) => void
  onOpenInBrowser?: (row: GitHubProjectRow) => void
}

function ProjectBoardCard({
  draggable,
  onDragEnd,
  onDragStart,
  onOpenDialog,
  onOpenInBrowser,
  onStartWork,
  row
}: {
  draggable: boolean
  onDragEnd: () => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
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
      draggable={draggable}
      aria-disabled={row.itemType === 'REDACTED' ? 'true' : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group/row rounded-md border border-border/50 bg-background px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        canStartWork ? 'cursor-pointer' : 'cursor-default opacity-60',
        draggable && 'cursor-grab active:cursor-grabbing'
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
  onEditField,
  onOpenDialog,
  onOpenInBrowser,
  onStartWork
}: Props): React.JSX.Element {
  const groupField = resolveGitHubProjectBoardGroupField(table)
  const columns = useMemo<TaskBoardColumn<GitHubProjectRow>[]>(
    () =>
      buildGitHubProjectBoardColumns(table).map((column) => ({
        key: column.key,
        label: column.label,
        issues: column.rows
      })),
    [table]
  )
  const draggedRowRef = useRef<GitHubProjectRow | null>(null)
  const pendingKeysRef = useRef(new Set<string>())
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set())
  const dragEnabled = groupField?.kind === 'single-select' && Boolean(onEditField)
  const dragDisabledReason = dragEnabled
    ? null
    : groupField?.kind === 'single-select'
      ? translate(
          'auto.components.github.project.ProjectBoardView.dragWriteUnavailable',
          'Drag is unavailable because changes cannot be written in this context.'
        )
      : groupField
        ? translate(
            'auto.components.github.project.ProjectBoardView.dragUnsupportedField',
            'Drag is unavailable because this board is grouped by {{value0}}. Only single-select fields can be changed by dragging.',
            { value0: groupField.name }
          )
        : translate(
            'auto.components.github.project.ProjectBoardView.dragMissingField',
            'Drag is unavailable because this board has no vertical group field.'
          )

  const handleDrop = async (column: TaskBoardColumn<GitHubProjectRow>): Promise<void> => {
    const row = draggedRowRef.current
    draggedRowRef.current = null
    if (!row || !groupField || groupField.kind !== 'single-select') {
      return
    }
    const pendingKey = `${row.id}:${groupField.id}`
    if (pendingKeysRef.current.has(pendingKey)) {
      return
    }
    const currentValue = row.fieldValuesByFieldId[groupField.id]
    const currentOptionId = currentValue?.kind === 'single-select' ? currentValue.optionId : null
    const nextOptionId = column.key === '__empty__' ? null : column.key
    if (nextOptionId && !groupField.options.some((option) => option.id === nextOptionId)) {
      return
    }
    if (currentOptionId === nextOptionId) {
      return
    }
    pendingKeysRef.current.add(pendingKey)
    setPendingKeys(new Set(pendingKeysRef.current))
    try {
      await onEditField?.(
        row,
        groupField.id,
        nextOptionId ? { kind: 'single-select', optionId: nextOptionId } : null
      )
    } catch {
      // The mutation owner reports provider errors; the board only releases its pending lock.
    } finally {
      pendingKeysRef.current.delete(pendingKey)
      setPendingKeys(new Set(pendingKeysRef.current))
    }
  }

  return (
    <TaskBoard
      columns={columns}
      dragDisabledReason={dragDisabledReason}
      onColumnDragOver={
        dragEnabled
          ? (_column, event) => {
              if (draggedRowRef.current) {
                event.preventDefault()
              }
            }
          : undefined
      }
      onColumnDrop={dragEnabled ? (column) => void handleDrop(column) : undefined}
      renderCard={(row) => (
        <ProjectBoardCard
          key={row.id}
          row={row}
          draggable={Boolean(
            dragEnabled &&
            row.itemType !== 'REDACTED' &&
            !pendingKeys.has(`${row.id}:${groupField?.id ?? ''}`)
          )}
          onDragStart={(event) => {
            if (
              !dragEnabled ||
              row.itemType === 'REDACTED' ||
              pendingKeysRef.current.has(`${row.id}:${groupField?.id ?? ''}`)
            ) {
              event.preventDefault()
              return
            }
            draggedRowRef.current = row
            event.dataTransfer?.setData('text/plain', row.id)
          }}
          onDragEnd={() => {
            draggedRowRef.current = null
          }}
          onOpenDialog={onOpenDialog}
          onOpenInBrowser={onOpenInBrowser}
          onStartWork={onStartWork}
        />
      )}
    />
  )
}
