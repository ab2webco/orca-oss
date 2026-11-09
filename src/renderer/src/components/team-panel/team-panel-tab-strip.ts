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

/** How far a strip shortened its labels to fit, and the width each longer level needed. */
export type TabStripFit = { level: number; needs: readonly number[] }

/** The next fit: one level shorter while the tabs overflow, one longer once its width is there. */
export function tabStripFitFor(
  fit: TabStripFit,
  strip: Pick<HTMLElement, 'scrollWidth' | 'clientWidth'>,
  lastLevel: number
): TabStripFit {
  if (strip.scrollWidth > strip.clientWidth + 1) {
    if (fit.level >= lastLevel) {
      return fit
    }
    const needs = [...fit.needs]
    needs[fit.level] = strip.scrollWidth
    return { level: fit.level + 1, needs }
  }
  const longer = fit.needs[fit.level - 1]
  return longer !== undefined && longer <= strip.clientWidth + 1
    ? { level: fit.level - 1, needs: fit.needs }
    : fit
}
