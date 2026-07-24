import React from 'react'
import { useDraggable } from '@dnd-kit/core'

import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { getPlanePriorityLabel } from './plane-work-item-sorter'
import type { PlaneWorkItem } from '../../../shared/plane-types'

type PlaneBoardCardProps = {
  item: PlaneWorkItem
  selected: boolean
  onOpenItem: (item: PlaneWorkItem) => void
}

// A single draggable work-item card. Mirrors the list row's info (identifier,
// title, priority, assignee) at board density. A distance activation
// constraint on the board's pointer sensor keeps plain clicks routing to
// onOpenItem instead of starting a drag.
export function PlaneBoardCard({
  item,
  selected,
  onOpenItem
}: PlaneBoardCardProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { type: 'card', stateId: item.state.id }
  })
  const primaryAssignee = item.assignees?.[0]
  const extraAssigneeCount = (item.assignees?.length ?? 0) - 1
  const priorityLabel = getPlanePriorityLabel(item.priority)

  return (
    <div
      ref={setNodeRef}
      aria-current={selected ? 'true' : undefined}
      data-current={selected ? 'true' : undefined}
      {...attributes}
      {...listeners}
      onClick={() => onOpenItem(item)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenItem(item)
        }
      }}
      className={cn(
        'group/card flex cursor-pointer flex-col gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 text-left shadow-xs transition hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected && 'border-ring/60 bg-accent',
        isDragging && 'opacity-40'
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {item.identifier}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{priorityLabel}</span>
      </div>
      <h3 className="line-clamp-2 min-w-0 text-[13px] font-medium text-foreground">{item.title}</h3>
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        {primaryAssignee?.avatarUrl ? (
          <img
            src={primaryAssignee.avatarUrl}
            alt={primaryAssignee.displayName}
            className="size-4 shrink-0 rounded-full"
          />
        ) : (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-[9px]">
            {primaryAssignee?.displayName?.slice(0, 1) ?? '-'}
          </span>
        )}
        <span className="min-w-0 truncate">
          {primaryAssignee?.displayName ??
            translate('auto.components.plane-board-card.unassigned', 'Unassigned')}
        </span>
        {extraAssigneeCount > 0 ? <span className="shrink-0">+{extraAssigneeCount}</span> : null}
      </div>
    </div>
  )
}
