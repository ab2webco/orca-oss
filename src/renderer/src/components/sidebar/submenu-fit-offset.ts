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

/**
 * Which side a popup opens on: beside its trigger when that fits, else below it, where Radix
 * shifts it sideways into the window. Why: a right-side popup cannot flip to a left side that is
 * also too narrow (ORCA-1163, the options menu at 320).
 */
export function popupSideThatFits(args: {
  triggerRight: number
  popupWidth: number
  sideOffset: number
  viewportWidth: number
}): 'right' | 'bottom' {
  return args.triggerRight + args.sideOffset + args.popupWidth + SUBMENU_EDGE_MARGIN_PX <=
    args.viewportWidth
    ? 'right'
    : 'bottom'
}
