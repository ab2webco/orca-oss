export const SIDEBAR_HOVER_CARD_OFFSET = 8
const WINDOW_MARGIN = 8

/** Beside the row while the card fits; under it on a window too narrow, where neither side fits. */
export function sidebarHoverCardSide({
  triggerRight,
  viewportWidth,
  cardWidth
}: {
  triggerRight: number
  viewportWidth: number
  cardWidth: number
}): 'right' | 'bottom' {
  return triggerRight + SIDEBAR_HOVER_CARD_OFFSET + cardWidth + WINDOW_MARGIN <= viewportWidth
    ? 'right'
    : 'bottom'
}
