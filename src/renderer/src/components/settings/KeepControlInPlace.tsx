import { useEffect, useRef } from 'react'

// Why a window: an anchor left armed would pull the page back on a late art load or a scroll.
const ANCHOR_MS = 1000

function scrollerOf(node: HTMLElement): HTMLElement | null {
  for (let one = node.parentElement; one; one = one.parentElement) {
    const { overflowY } = getComputedStyle(one)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return one
    }
  }
  return null
}

/**
 * Holds the control just pressed at the same height on screen when the rows it hides or shows
 * sit above it (ORCA-1112 d), so the page never moves under the pointer.
 */
export function KeepControlInPlace({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) {
      return
    }
    let anchor: { node: Element; top: number; until: number } | null = null
    const arm = (event: Event): void => {
      const node = event.target instanceof Element ? event.target : null
      anchor = node
        ? { node, top: node.getBoundingClientRect().top, until: Date.now() + ANCHOR_MS }
        : null
    }
    const disarm = (): void => {
      anchor = null
    }
    // Why a MutationObserver: it runs after React's commit and before paint, so no frame jumps.
    const observer = new MutationObserver(() => {
      if (!anchor || !anchor.node.isConnected || Date.now() > anchor.until) {
        anchor = null
        return
      }
      const delta = anchor.node.getBoundingClientRect().top - anchor.top
      if (delta !== 0) {
        scrollerOf(root)?.scrollBy({ top: delta })
      }
    })
    observer.observe(root, { childList: true, subtree: true })
    root.addEventListener('pointerdown', arm, true)
    root.addEventListener('keydown', arm, true)
    root.addEventListener('wheel', disarm, { passive: true })
    root.addEventListener('touchmove', disarm, { passive: true })
    return () => {
      observer.disconnect()
      root.removeEventListener('pointerdown', arm, true)
      root.removeEventListener('keydown', arm, true)
      root.removeEventListener('wheel', disarm)
      root.removeEventListener('touchmove', disarm)
    }
  }, [])
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
