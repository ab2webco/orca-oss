import { useLayoutEffect, useState } from 'react'

const RECHECK_MS = 250
const OPEN_LAYER_SELECTOR = '[role="menu"], [role="dialog"], [role="alertdialog"]'

/**
 * Whether nothing is drawn over the element's centre and no menu or dialog is open, re-read while
 * `active`; false when inactive. A change of `recheckKey` re-reads in the same frame, before paint.
 */
export function useElementUncovered(
  element: HTMLElement | null,
  active: boolean,
  recheckKey?: unknown
): boolean {
  const [uncovered, setUncovered] = useState(false)
  useLayoutEffect(() => {
    if (!active || !element) {
      return
    }
    const read = (): void => {
      // Why: a tooltip that opens after a menu or dialog becomes the top layer and takes its Escape (ORCA-1256).
      if (document.querySelector(OPEN_LAYER_SELECTOR)) {
        setUncovered(false)
        return
      }
      const box = element.getBoundingClientRect()
      // Why null counts as uncovered: it means no layout (unit tests) or off-window, not another element on top.
      const hit = document.elementFromPoint?.(box.left + box.width / 2, box.top + box.height / 2)
      setUncovered(!hit || element.contains(hit))
    }
    read()
    // Why polled: a narrow window lays the Team panel over the left sidebar with no event to hear.
    const timer = window.setInterval(read, RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [active, element, recheckKey])
  return active && uncovered
}
