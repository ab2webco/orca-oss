import { useLayoutEffect, useRef } from 'react'
import type React from 'react'

export const PINNED_HOST_HEIGHT_VARIABLE = '--worktree-sidebar-pinned-host-height'
const PINNED_HOST_SELECTOR = '[data-worktree-sticky-host-active]'

// Measures the pinned host card so the project tier pins flush beneath it (ORCA-1216 §8):
// the ref feeds the handoff math, the CSS variable the group header's `top`.
export function usePinnedHostHeight(
  scrollRef: React.RefObject<HTMLDivElement | null>
): React.MutableRefObject<number | undefined> {
  const heightRef = useRef<number | undefined>(undefined)
  const observedRef = useRef<{ element: Element; observer: ResizeObserver } | null>(null)

  useLayoutEffect(() => {
    const root = scrollRef.current
    const host = root?.querySelector(PINNED_HOST_SELECTOR) ?? null
    const publish = (element: Element): void => {
      const height = element.getBoundingClientRect().height
      if (!root || height <= 0 || height === heightRef.current) {
        return
      }
      heightRef.current = height
      root.style.setProperty(PINNED_HOST_HEIGHT_VARIABLE, `${height}px`)
    }
    if (host) {
      publish(host)
    }
    if (observedRef.current?.element === host) {
      return
    }
    observedRef.current?.observer.disconnect()
    observedRef.current = null
    if (host && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => publish(host))
      observer.observe(host)
      observedRef.current = { element: host, observer }
    }
  })

  useLayoutEffect(
    () => () => {
      observedRef.current?.observer.disconnect()
      observedRef.current = null
    },
    []
  )

  return heightRef
}
