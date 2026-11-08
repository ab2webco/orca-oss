import { useLayoutEffect, useState } from 'react'

const RECHECK_MS = 250

/** Whether nothing is drawn over the element's centre, re-read while `active`; false when inactive. */
export function useElementUncovered(element: HTMLElement | null, active: boolean): boolean {
  const [uncovered, setUncovered] = useState(false)
  useLayoutEffect(() => {
    if (!active || !element) {
      return
    }
    const read = (): void => {
      const box = element.getBoundingClientRect()
      // Why null counts as uncovered: it means no layout (unit tests) or off-window, not another element on top.
      const hit = document.elementFromPoint?.(box.left + box.width / 2, box.top + box.height / 2)
      setUncovered(!hit || element.contains(hit))
    }
    read()
    // Why polled: a narrow window lays the Team panel over the left sidebar with no event to hear.
    const timer = window.setInterval(read, RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [active, element])
  return active && uncovered
}
