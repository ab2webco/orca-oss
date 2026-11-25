export const RIGHT_SIDEBAR_MIN_WIDTH = 220
export const RIGHT_SIDEBAR_MIN_NON_SIDEBAR_AREA = 320
export const RIGHT_SIDEBAR_ABSOLUTE_FALLBACK_MAX_WIDTH = 2000

export function computeMaxRightSidebarPanelWidth(
  windowWidth: number | null | undefined,
  renderedExtraWidth: number
): number {
  if (typeof windowWidth !== 'number' || !Number.isFinite(windowWidth)) {
    return RIGHT_SIDEBAR_ABSOLUTE_FALLBACK_MAX_WIDTH
  }

  return Math.max(
    RIGHT_SIDEBAR_MIN_WIDTH,
    windowWidth - RIGHT_SIDEBAR_MIN_NON_SIDEBAR_AREA - renderedExtraWidth
  )
}

export function clampRightSidebarPanelWidth(
  width: number,
  windowWidth: number | null | undefined,
  renderedExtraWidth: number
): number {
  return Math.min(
    computeMaxRightSidebarPanelWidth(windowWidth, renderedExtraWidth),
    Math.max(RIGHT_SIDEBAR_MIN_WIDTH, width)
  )
}

// Why 120: below it a terminal cannot show a prompt line; above it the columns layout is unchanged
// (768 with both sidebars open keeps its ~137 px content column).
export const RIGHT_SIDEBAR_OVERLAY_MIN_CONTENT_WIDTH = 120

/**
 * Whether the right panel should overlay the content instead of taking a column.
 * Why: below this width both sidebars plus a usable content area overflow the app row,
 * and a focused popup scrolls that row sideways (ORCA-1163).
 */
export function rightSidebarOverlaysContent(args: {
  windowWidth: number | null | undefined
  leftSidebarWidth: number
  rightPanelWidth: number
}): boolean {
  const { windowWidth, leftSidebarWidth, rightPanelWidth } = args
  if (typeof windowWidth !== 'number' || !Number.isFinite(windowWidth)) {
    return false
  }
  return leftSidebarWidth + rightPanelWidth + RIGHT_SIDEBAR_OVERLAY_MIN_CONTENT_WIDTH > windowWidth
}

export const ACTIVITY_BAR_SIDE_WIDTH = 40

/** Whether the right sidebar, opened now with this layout, would overlay the content. */
export function rightSidebarWouldOverlay(args: {
  windowWidth: number | null | undefined
  sidebarOpen: boolean
  sidebarWidth: number
  rightSidebarWidth: number
  activityBarPosition: string
}): boolean {
  const barWidth = args.activityBarPosition === 'side' ? ACTIVITY_BAR_SIDE_WIDTH : 0
  return rightSidebarOverlaysContent({
    windowWidth: args.windowWidth,
    leftSidebarWidth: args.sidebarOpen ? args.sidebarWidth : 0,
    rightPanelWidth:
      clampRightSidebarPanelWidth(args.rightSidebarWidth, args.windowWidth, barWidth) + barWidth
  })
}
