import React, { useRef } from 'react'

import { cn } from '@/lib/utils'
import { PlaneBoardFloatingMinimap } from './plane-board-floating-minimap'

export type TaskBoardColumn<T> = {
  key: string
  label: string
  issues: T[]
}

type TaskBoardProps<T> = {
  columns: TaskBoardColumn<T>[]
  dragDisabledReason: string | null
  renderCard: (item: T) => React.ReactNode
  onColumnDragOver?: (column: TaskBoardColumn<T>, event: React.DragEvent<HTMLElement>) => void
  onColumnDrop?: (column: TaskBoardColumn<T>, event: React.DragEvent<HTMLElement>) => void
  dragOverColumnKey?: string | null
}

/** Native drag remains provider-specific; this only shares Plane's column presentation. */
export function TaskBoard<T>({
  columns,
  dragDisabledReason,
  renderCard,
  onColumnDragOver,
  onColumnDrop,
  dragOverColumnKey
}: TaskBoardProps<T>): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {dragDisabledReason ? (
        <p
          role="note"
          className="flex-none border-b border-border/50 bg-muted/35 px-3 py-1.5 text-[11px] text-muted-foreground"
        >
          {dragDisabledReason}
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          data-task-board-scroll
          className="flex h-full min-h-0 gap-3 overflow-x-auto scrollbar-sleek p-3"
        >
          {columns.map((column) => (
            <section
              key={column.key}
              data-task-board-column
              onDragOver={(event) => onColumnDragOver?.(column, event)}
              onDrop={(event) => onColumnDrop?.(column, event)}
              className={cn(
                'flex h-full min-h-0 w-72 shrink-0 flex-col rounded-md border border-border/50 bg-muted/20 transition-[border-color,box-shadow]',
                dragOverColumnKey === column.key && 'border-ring/70 ring-1 ring-ring/70'
              )}
            >
              <div className="flex h-9 flex-none items-center justify-between border-b border-border/50 px-3">
                <span
                  data-task-board-column-label
                  className="truncate text-xs font-medium text-foreground"
                >
                  {column.label}
                </span>
                <span className="text-[11px] text-muted-foreground">{column.issues.length}</span>
              </div>
              <div
                data-task-board-column-cards
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scrollbar-sleek p-2"
              >
                {column.issues.map(renderCard)}
              </div>
            </section>
          ))}
        </div>
        <PlaneBoardFloatingMinimap
          columnCount={columns.length}
          scrollContainerRef={scrollContainerRef}
        />
      </div>
    </div>
  )
}
