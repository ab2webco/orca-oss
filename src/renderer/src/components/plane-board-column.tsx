import React, { useCallback } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { GripVertical } from 'lucide-react'

import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { PlaneBoardCard } from './plane-board-card'
import { planeBoardColumnDroppableId, type PlaneBoardColumn } from './plane-board-drag'
import type { PlaneWorkItem } from '../../../shared/plane-types'

type PlaneBoardColumnViewProps = {
  column: PlaneBoardColumn
  getStateTone: (stateGroup: string) => string
  selectedItemId: string | null
  onOpenItem: (item: PlaneWorkItem) => void
}

// One state column: sticky header (drag handle + tone dot + name + count) over a
// vertically scrolling card list. The whole column stays a card droppable (drop
// a card anywhere inside → this state) AND a horizontal sortable (reorder
// columns) — the two dnd-kit refs are composed onto the root node. Only the
// header grip carries the sortable listeners so grabbing the body still drags
// cards.
export function PlaneBoardColumnView({
  column,
  getStateTone,
  selectedItemId,
  onOpenItem
}: PlaneBoardColumnViewProps): React.JSX.Element {
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: planeBoardColumnDroppableId(column.stateId),
    data: { type: 'column', stateId: column.stateId }
  })
  const {
    setNodeRef: setSortableRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: column.stateId,
    data: { type: 'column', stateId: column.stateId }
  })

  // Compose both dnd-kit refs onto the single column node.
  const composedRef = useCallback(
    (node: HTMLElement | null) => {
      setDroppableRef(node)
      setSortableRef(node)
    },
    [setDroppableRef, setSortableRef]
  )

  // Build the transform inline (no @dnd-kit/utilities dep, which is not a direct
  // dependency). translate3d keeps the drag on the compositor.
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition
  }

  return (
    <div
      ref={composedRef}
      style={style}
      className={cn(
        'flex h-full w-72 shrink-0 flex-col rounded-md border border-border/50 bg-muted/20 transition-colors',
        isOver && 'border-ring/60 bg-accent/40',
        isDragging && 'z-10 opacity-60'
      )}
    >
      <div className="flex flex-none items-center gap-2 border-b border-border/50 px-3 py-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={translate(
            'auto.components.plane-board-column.reorder',
            'Reorder {{value0}} column',
            { value0: column.state.name }
          )}
          className="flex size-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
        <span
          aria-hidden
          className={cn('size-2 shrink-0 rounded-full border', getStateTone(column.state.group))}
        />
        <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
          {column.state.name}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {column.items.length}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scrollbar-sleek p-2">
        {column.items.map((item) => (
          <PlaneBoardCard
            key={`${item.workspaceId ?? 'workspace'}:${item.id || item.identifier}`}
            item={item}
            selected={item.id === selectedItemId}
            onOpenItem={onOpenItem}
          />
        ))}
      </div>
    </div>
  )
}
