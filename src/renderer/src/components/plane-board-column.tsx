import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { GripVertical, MoreVertical, Pencil, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { PlaneBoardAddCard } from '@/components/plane-board-add-card'
import { PlaneBoardCard } from './plane-board-card'
import { planeBoardColumnDroppableId, type PlaneBoardColumn } from './plane-board-drag'
import type { PlaneWorkItem } from '../../../shared/plane-types'

type PlaneBoardColumnViewProps = {
  column: PlaneBoardColumn
  getStateTone: (stateGroup: string) => string
  selectedItemId: string | null
  onOpenItem: (item: PlaneWorkItem) => void
  /** Commit a new name for this column (state). No-op if unchanged/empty. */
  onRenameColumn: (stateId: string, name: string) => void
  /** Delete this column (state) after a destructive confirmation. */
  onDeleteColumn: (stateId: string, name: string) => void
  /** Create a work item in this column's state; true on success. */
  onCreateItem: (stateId: string, title: string) => Promise<boolean>
  /** Delete a work item after a destructive confirmation. */
  onDeleteItem: (item: PlaneWorkItem) => void
}

// One state column: sticky header (drag handle + tone dot + name + count) over a
// vertically scrolling card list. The whole column stays a card droppable (drop
// a card anywhere inside → this state) AND a horizontal sortable (reorder
// columns) — the two dnd-kit refs are composed onto the root node. Only the
// header grip carries the sortable listeners so grabbing the body still drags
// cards. The name is inline-editable (click or pencil) without disturbing drag.
export function PlaneBoardColumnView({
  column,
  getStateTone,
  selectedItemId,
  onOpenItem,
  onRenameColumn,
  onDeleteColumn,
  onCreateItem,
  onDeleteItem
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

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(column.state.name)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const beginEdit = useCallback(() => {
    setDraft(column.state.name)
    setEditing(true)
  }, [column.state.name])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = useCallback(() => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== column.state.name) {
      onRenameColumn(column.stateId, next)
    }
  }, [draft, column.state.name, column.stateId, onRenameColumn])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setEditing(false)
      }
    },
    [commit]
  )

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
      <div className="group flex flex-none items-center gap-2 border-b border-border/50 px-3 py-2">
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
        {editing ? (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            aria-label={translate('auto.components.plane-board-column.renameLabel', 'Column name')}
            className="h-6 min-w-0 flex-1 px-1.5 py-0 text-[12px]"
          />
        ) : (
          <button
            type="button"
            onClick={beginEdit}
            title={translate('auto.components.plane-board-column.rename', 'Rename column')}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
              {column.state.name}
            </span>
            <Pencil className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60" />
          </button>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {column.items.length}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={translate('auto.components.plane-board-column.menu', 'Column actions')}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={beginEdit}>
              <Pencil />
              {translate('auto.components.plane-board-column.rename', 'Rename column')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDeleteColumn(column.stateId, column.state.name)}
            >
              <Trash2 />
              {translate('auto.components.plane-board-column.delete', 'Delete column')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scrollbar-sleek p-2">
        {column.items.map((item) => (
          <PlaneBoardCard
            key={`${item.workspaceId ?? 'workspace'}:${item.id || item.identifier}`}
            item={item}
            selected={item.id === selectedItemId}
            onOpenItem={onOpenItem}
            onDeleteItem={onDeleteItem}
          />
        ))}
        <PlaneBoardAddCard onCreate={(title) => onCreateItem(column.stateId, title)} />
      </div>
    </div>
  )
}
