// Pure viewport-geometry math for the Kanban board's draggable minimap. Kept
// separate from the component so the mapping between the scroll container's
// metrics and the viewport rectangle (and its inverse) is unit-testable. The
// minimap width acts as the track width; the rectangle is the "thumb".

export type ScrollbarMetrics = {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
  trackWidth: number
}

export type ScrollbarThumb = {
  thumbWidth: number
  thumbLeft: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// thumbWidth = (clientWidth / scrollWidth) * trackWidth
// thumbLeft  = (scrollLeft  / scrollWidth) * trackWidth
// Both are clamped so the thumb never overflows the track.
export function computeScrollbarThumb(metrics: ScrollbarMetrics): ScrollbarThumb {
  const { scrollLeft, scrollWidth, clientWidth, trackWidth } = metrics
  if (scrollWidth <= 0 || trackWidth <= 0) {
    return { thumbWidth: 0, thumbLeft: 0 }
  }
  const widthRatio = Math.min(1, clientWidth / scrollWidth)
  const thumbWidth = widthRatio * trackWidth
  const maxThumbLeft = Math.max(0, trackWidth - thumbWidth)
  const thumbLeft = clamp((scrollLeft / scrollWidth) * trackWidth, 0, maxThumbLeft)
  return { thumbWidth, thumbLeft }
}

// Inverse of computeScrollbarThumb's left mapping: a thumb-left offset (px)
// projects back to a scrollLeft, clamped to [0, scrollWidth - clientWidth].
export function scrollLeftFromThumbLeft(args: {
  thumbLeft: number
  scrollWidth: number
  clientWidth: number
  trackWidth: number
}): number {
  const { thumbLeft, scrollWidth, clientWidth, trackWidth } = args
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth)
  if (trackWidth <= 0) {
    return 0
  }
  return clamp((thumbLeft / trackWidth) * scrollWidth, 0, maxScrollLeft)
}
