const SUBMENU_EDGE_MARGIN_PX = 8

/**
 * A Radix sideOffset that pulls a submenu back over its parent menu when it would leave the
 * window. Why: Radix SubContent can only flip sides, and at 320 neither side has room (ORCA-1163).
 */
export function submenuFitSideOffset(args: {
  triggerRight: number
  submenuWidth: number
  viewportWidth: number
}): number {
  const overflow =
    args.triggerRight + args.submenuWidth + SUBMENU_EDGE_MARGIN_PX - args.viewportWidth
  return overflow > 0 ? -overflow : 0
}
