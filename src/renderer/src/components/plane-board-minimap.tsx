import React, { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { PlaneBoardColumn } from './plane-board-drag'

type PlaneBoardMinimapProps = {
  columns: PlaneBoardColumn[]
  getStateTone: (stateGroup: string) => string
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

// Pick the child column whose left edge is nearest the current scroll offset;
// that is the "most-visible" column highlighted in the strip.
function resolveActiveColumnIndex(container: HTMLDivElement): number {
  const { scrollLeft } = container
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < container.children.length; index += 1) {
    const child = container.children[index]
    if (!(child instanceof HTMLElement)) {
      continue
    }
    const distance = Math.abs(child.offsetLeft - scrollLeft)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }
  return nearestIndex
}

// A Jira-style column navigator strip: one clickable segment per column (tone
// dot + truncated name + count). Renders nothing unless the columns overflow
// horizontally. Clicking a segment smoothly scrolls its column into view; the
// most-visible column's segment is highlighted.
export function PlaneBoardMinimap({
  columns,
  getStateTone,
  scrollContainerRef
}: PlaneBoardMinimapProps): React.JSX.Element | null {
  const frameRef = useRef<number | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [overflowing, setOverflowing] = useState(false)

  const recompute = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }
    setOverflowing(container.scrollWidth > container.clientWidth + 1)
    setActiveIndex(resolveActiveColumnIndex(container))
  }, [scrollContainerRef])

  // Recompute on scroll (rAF-throttled), on container resize, and on window
  // resize. Depend on column count so adding/removing a column re-measures.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }
    recompute()
    const onScroll = (): void => {
      if (frameRef.current !== null) {
        return
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        recompute()
      })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    window.addEventListener('resize', recompute)
    return () => {
      container.removeEventListener('scroll', onScroll)
      observer.disconnect()
      window.removeEventListener('resize', recompute)
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [recompute, scrollContainerRef, columns.length])

  const scrollToColumn = useCallback(
    (index: number) => {
      const child = scrollContainerRef.current?.children[index]
      if (child instanceof HTMLElement) {
        child.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
      }
    },
    [scrollContainerRef]
  )

  if (!overflowing) {
    return null
  }

  return (
    <div
      role="navigation"
      aria-label={translate('auto.components.plane-board-minimap.label', 'Board columns')}
      className="flex-none border-b border-border/50 px-3 py-1.5"
    >
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-sleek">
        {columns.map((column, index) => {
          const isActive = index === activeIndex
          return (
            <button
              key={column.stateId}
              type="button"
              aria-current={isActive ? 'true' : undefined}
              onClick={() => scrollToColumn(index)}
              title={column.state.name}
              aria-label={translate(
                'auto.components.plane-board-minimap.navigate',
                'Go to {{value0}} column',
                { value0: column.state.name }
              )}
              className={cn(
                'flex min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                isActive && 'border-border/60 bg-accent text-foreground'
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-2 shrink-0 rounded-full border',
                  getStateTone(column.state.group)
                )}
              />
              <span className="max-w-24 truncate font-medium">{column.state.name}</span>
              <span className="shrink-0 text-muted-foreground">{column.items.length}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
