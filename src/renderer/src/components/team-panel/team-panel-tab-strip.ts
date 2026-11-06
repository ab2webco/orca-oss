type Span = Pick<DOMRect, 'left' | 'right'>

const STRIP_INSET_PX = 12

/** The strip's next `scrollLeft` to show a tab whole. */
export function tabStripScrollLeftFor(strip: Span, tab: Span, scrollLeft: number): number {
  if (tab.right > strip.right) {
    return scrollLeft + tab.right - strip.right + STRIP_INSET_PX
  }
  if (tab.left < strip.left) {
    return scrollLeft + tab.left - strip.left - STRIP_INSET_PX
  }
  return scrollLeft
}
