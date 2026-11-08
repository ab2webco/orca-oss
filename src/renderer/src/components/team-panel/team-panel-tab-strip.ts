type Span = Pick<DOMRect, 'left' | 'right'>

/** The strip's padding, faded when tabs lie past that edge; a tab inside it counts as hidden. */
export const STRIP_INSET_PX = 12

/** The strip's next `scrollLeft` to show a tab whole. */
export function tabStripScrollLeftFor(strip: Span, tab: Span, scrollLeft: number): number {
  if (tab.right > strip.right - STRIP_INSET_PX) {
    return scrollLeft + tab.right - strip.right + STRIP_INSET_PX
  }
  if (tab.left < strip.left + STRIP_INSET_PX) {
    return scrollLeft + tab.left - strip.left - STRIP_INSET_PX
  }
  return scrollLeft
}

export type TabStripOverflow = { start: boolean; end: boolean }

// Why the 1 px slack: fractional widths leave scrollWidth a hair over clientWidth when all fit.
/** Which edges hide tabs, so the strip can fade there. */
export function tabStripOverflowOf(
  strip: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>
): TabStripOverflow {
  return {
    start: strip.scrollLeft > 1,
    end: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
  }
}
