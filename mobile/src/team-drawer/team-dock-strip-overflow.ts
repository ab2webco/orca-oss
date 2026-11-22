/** Whether chips still run past the strip's right edge, so the fade must say it scrolls. */
export function teamDockStripOverflows(contentWidth: number, viewWidth: number, scrollX: number) {
  return contentWidth - viewWidth - scrollX > 1
}
