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
    let anchor: { node: Element; top: number } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    // Why a MutationObserver: it runs after React's commit and before paint, so no frame jumps.
    const observer = new MutationObserver(() => {
      if (!anchor || !anchor.node.isConnected) {
        disarm()
        return
      }
      const delta = anchor.node.getBoundingClientRect().top - anchor.top
      if (delta !== 0) {
        scrollerOf(root)?.scrollBy({ top: delta })
      }
    })
    const disarm = (): void => {
      anchor = null
      clearTimeout(timer)
      observer.disconnect()
    }
    // Why observe only while armed: the page's animated previews mutate it every frame.
    const arm = (event: Event): void => {
      disarm()
      if (!(event.target instanceof Element)) {
        return
      }
      anchor = { node: event.target, top: event.target.getBoundingClientRect().top }
      observer.observe(root, { childList: true, subtree: true })
      timer = setTimeout(disarm, ANCHOR_MS)
    }
    root.addEventListener('pointerdown', arm, true)
    root.addEventListener('keydown', arm, true)
    root.addEventListener('wheel', disarm, { passive: true })
    root.addEventListener('touchmove', disarm, { passive: true })
    return () => {
      disarm()
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
