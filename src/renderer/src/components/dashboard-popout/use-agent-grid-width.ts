import { useEffect, useState, type RefObject } from 'react'

/**
 * Measured content width of the grid's laid-out container.
 *
 * Zero until the observer reports; callers substitute a fallback rather than
 * rendering a one-column grid for a frame.
 */
export function useAgentGridWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const measure = (): void => {
      const next = element.getBoundingClientRect().width
      setWidth((current) => (current === next ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return width
}

/** Measured content box of the grid's container. Zero until the observer reports. */
export function useAgentGridSize(ref: RefObject<HTMLElement | null>): {
  width: number
  height: number
} {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const measure = (): void => {
      const box = element.getBoundingClientRect()
      setSize((current) =>
        current.width === box.width && current.height === box.height
          ? current
          : { width: box.width, height: box.height }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}

/**
 * Height the grid can occupy: the viewport below its own top edge.
 *
 * Why not `flex-1`: that distributes free space, and a host that leaves the
 * chain without a definite height has none — the rows then collapse to their
 * content, which is the fixed-looking grid the owner reported (ORCA-234).
 * Measuring from the viewport has no feedback loop because the grid is last.
 */
export function useAgentGridAvailableHeight(
  ref: RefObject<HTMLElement | null>,
  bottomGap = 12
): number {
  const [available, setAvailable] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return undefined
    }
    const measure = (): void => {
      const top = element.getBoundingClientRect().top
      const next = Math.max(0, window.innerHeight - top - bottomGap)
      setAvailable((current) => (current === next ? current : next))
    }
    measure()
    window.addEventListener('resize', measure)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(document.documentElement)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [ref, bottomGap])

  return available
}
