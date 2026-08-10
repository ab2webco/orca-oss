import React, { useCallback, useEffect, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { computeScrollbarThumb, scrollLeftFromThumbLeft } from './plane-board-minimap-geometry'

type PlaneBoardFloatingMinimapProps = {
  /** Column count drives the number of "simulated column" segments drawn. */
  columnCount: number
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

type ScrollMetrics = {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

const EMPTY_METRICS: ScrollMetrics = { scrollLeft: 0, scrollWidth: 0, clientWidth: 0 }

// A Jira-style floating board minimap: a small rounded card pinned to the
// board's bottom-center that simulates the columns as thin vertical segments
// with a draggable translucent viewport rectangle overlaid on top. Dragging the
// rectangle pans the board; clicking elsewhere jumps the viewport to center on
// the pointer. Renders nothing unless the board overflows horizontally. The
// track width is the minimap's inner width, reused by the pure geometry helper.
export function PlaneBoardFloatingMinimap({
  columnCount,
  scrollContainerRef
}: PlaneBoardFloatingMinimapProps): React.JSX.Element | null {
  // Why the minimap names the scroller: role="scrollbar" requires aria-controls,
  // and the board's overflow div carries no id of its own. Owning the id here
  // keeps the a11y contract with the element that declares the role.
  const scrollContainerId = useId()
  const trackRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startLeft: number } | null>(null)
  const [metrics, setMetrics] = useState<ScrollMetrics>(EMPTY_METRICS)
  const [trackWidth, setTrackWidth] = useState(0)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.id = scrollContainerId
    }
  }, [scrollContainerId, scrollContainerRef])

  const recompute = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }
    setMetrics({
      scrollLeft: container.scrollLeft,
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth
    })
    setTrackWidth(trackRef.current?.clientWidth ?? 0)
  }, [scrollContainerRef])

  // Recompute on scroll (rAF-throttled), on container resize, on track resize,
  // and on window resize. Depend on column count so adding/removing a column
  // re-measures overflow.
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
    if (trackRef.current) {
      observer.observe(trackRef.current)
    }
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
  }, [recompute, scrollContainerRef, columnCount])

  const overflowing = metrics.scrollWidth > metrics.clientWidth + 1
  const { thumbWidth: viewportWidth, thumbLeft: viewportLeft } = computeScrollbarThumb({
    ...metrics,
    trackWidth
  })

  const scrollToViewportLeft = useCallback(
    (nextLeft: number) => {
      const container = scrollContainerRef.current
      if (!container) {
        return
      }
      container.scrollLeft = scrollLeftFromThumbLeft({
        thumbLeft: nextLeft,
        scrollWidth: metrics.scrollWidth,
        clientWidth: metrics.clientWidth,
        trackWidth
      })
    },
    [scrollContainerRef, metrics.scrollWidth, metrics.clientWidth, trackWidth]
  )

  // Drag pans the board; stopPropagation keeps the drag from triggering the
  // track's click-to-center handler.
  const onViewportPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      viewportRef.current?.setPointerCapture(event.pointerId)
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startLeft: viewportLeft
      }
    },
    [viewportLeft]
  )

  const onViewportPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) {
        return
      }
      scrollToViewportLeft(drag.startLeft + (event.clientX - drag.startX))
    },
    [scrollToViewportLeft]
  )

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      viewportRef.current?.releasePointerCapture(event.pointerId)
      dragRef.current = null
    }
  }, [])

  // Click anywhere on the track (outside the rectangle) jumps the viewport so
  // its center lands under the pointer.
  const onTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const track = trackRef.current
      if (!track) {
        return
      }
      const localX = event.clientX - track.getBoundingClientRect().left
      scrollToViewportLeft(localX - viewportWidth / 2)
    },
    [scrollToViewportLeft, viewportWidth]
  )

  if (!overflowing) {
    return null
  }

  const maxScrollLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth)
  const valueNow = maxScrollLeft > 0 ? Math.round((metrics.scrollLeft / maxScrollLeft) * 100) : 0
  const segments = Array.from(
    { length: Math.max(1, columnCount) },
    (_, index) => `segment-${index}`
  )

  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2',
        'h-8 w-56 rounded-lg border border-border bg-popover/90 shadow-md backdrop-blur'
      )}
    >
      <div
        ref={trackRef}
        role="scrollbar"
        aria-controls={scrollContainerId}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={valueNow}
        aria-label={translate(
          'auto.components.plane-board-floating-minimap.label',
          'Drag to scroll board columns'
        )}
        onPointerDown={onTrackPointerDown}
        className="pointer-events-auto relative h-full w-full cursor-pointer overflow-hidden rounded-lg px-1.5 py-1.5"
      >
        <div aria-hidden className="flex h-full w-full items-stretch gap-1">
          {segments.map((key) => (
            <div key={key} className="min-w-0 flex-1 rounded-sm bg-muted-foreground/25" />
          ))}
        </div>
        <div
          ref={viewportRef}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ width: `${viewportWidth}px`, transform: `translateX(${viewportLeft}px)` }}
          className={cn(
            'absolute inset-y-1.5 left-1.5 cursor-grab rounded-md border border-primary/60 bg-primary/20',
            'transition-colors hover:bg-primary/30 active:cursor-grabbing active:bg-primary/40'
          )}
        />
      </div>
    </div>
  )
}
