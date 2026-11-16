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

  // Why no deps: the pinned host card is whichever row is sticky now, so it can change on any render.
  useLayoutEffect(() => {
    const root = scrollRef.current
    const host = root?.querySelector(PINNED_HOST_SELECTOR) ?? null
    if (!root || !host) {
      return undefined
    }
    const publish = (): void => {
      const height = host.getBoundingClientRect().height
      if (height <= 0 || height === heightRef.current) {
        return
      }
      heightRef.current = height
      root.style.setProperty(PINNED_HOST_HEIGHT_VARIABLE, `${height}px`)
    }
    publish()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver(publish)
    observer.observe(host)
    return () => observer.disconnect()
  })

  return heightRef
}
