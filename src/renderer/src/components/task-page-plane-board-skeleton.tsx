import React from 'react'

import type { PlaneViewMode } from '../../../shared/types'

export type PlaneLoadingSkeleton = PlaneViewMode | null

// Single decision point for which loading placeholder the Plane pane shows,
// so the skeleton always matches the layout the data will land in.
export function resolvePlaneLoadingSkeleton(args: {
  loading: boolean
  itemCount: number
  viewMode: PlaneViewMode
}): PlaneLoadingSkeleton {
  if (!args.loading || args.itemCount > 0) {
    return null
  }
  return args.viewMode
}

// Deterministic variation so the shimmer reads as real content, not stripes.
const COLUMN_CARD_COUNTS = [4, 3, 5, 2, 3]
const CARD_TITLE_WIDTHS = ['w-4/5', 'w-3/5', 'w-full', 'w-2/3']

// Board-shaped loading placeholder for the Plane kanban view. Every structural
// class mirrors TaskPagePlaneBoard / PlaneBoardColumnView / PlaneBoardCard so
// the layout keeps its shape when real columns land.
export function TaskPagePlaneBoardSkeleton(): React.JSX.Element {
  return (
    <div aria-hidden data-testid="plane-board-skeleton" className="flex h-full min-h-0 flex-col">
      <div className="flex h-full min-h-0 flex-1 gap-3 overflow-hidden p-3">
        {COLUMN_CARD_COUNTS.map((cardCount, columnIndex) => (
          <div
            key={columnIndex}
            className="flex h-full w-72 shrink-0 flex-col rounded-md border border-border/50 bg-muted/20"
          >
            <div className="flex flex-none items-center gap-2 border-b border-border/50 px-3 py-2">
              <div className="size-2 shrink-0 animate-pulse rounded-full bg-muted/70" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted/70" />
              <div className="ml-auto h-3 w-4 shrink-0 animate-pulse rounded bg-muted/60" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
              {Array.from({ length: cardCount }).map((_, cardIndex) => (
                <div
                  key={cardIndex}
                  className="flex flex-col gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 shadow-xs"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-12 animate-pulse rounded bg-muted/70" />
                    <div className="ml-auto h-3 w-8 animate-pulse rounded bg-muted/60" />
                  </div>
                  <div
                    className={`h-3.5 animate-pulse rounded bg-muted/70 ${CARD_TITLE_WIDTHS[(columnIndex + cardIndex) % CARD_TITLE_WIDTHS.length]}`}
                  />
                  <div className="flex items-center gap-2">
                    <div className="size-4 shrink-0 animate-pulse rounded-full bg-muted/60" />
                    <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
