const WINDOW_MARGIN_PX = 8

type TriggerRect = { left: number; right: number; height: number }

/**
 * Radix offsets that keep a + menu submenu inside the window. Radix SubContent opens only to the
 * right or left; when neither fits (390, 320) it is pulled back over its menu, below its own row.
 */
export function submenuOffsetsInWindow(args: {
  trigger: TriggerRect
  width: number
  sideOffset: number
  viewportWidth: number
}): { sideOffset: number; alignOffset: number } {
  const { trigger, sideOffset, viewportWidth } = args
  const width = Math.min(args.width, viewportWidth - 2 * WINDOW_MARGIN_PX)
  const fitsRight = trigger.right + sideOffset + width + WINDOW_MARGIN_PX <= viewportWidth
  const fitsLeft = trigger.left - sideOffset - width - WINDOW_MARGIN_PX >= 0
  if (fitsRight || fitsLeft) {
    return { sideOffset, alignOffset: 0 }
  }
  return {
    sideOffset: viewportWidth - WINDOW_MARGIN_PX - width - trigger.right,
    alignOffset: trigger.height
  }
}

/**
 * A SubContent onFocusOutside: Radix focuses the parent menu itself when the pointer leaves the
 * trigger on a path it does not read as toward the submenu (a left-side or pulled-in one), and
 * that closed the submenu under the pointer. A focused item of the parent still closes it.
 */
export function keepSubmenuOpenOnParentMenuFocus(event: {
  target: EventTarget | null
  preventDefault: () => void
}): void {
  if (event.target instanceof Element && event.target.getAttribute('role') === 'menu') {
    event.preventDefault()
  }
}
