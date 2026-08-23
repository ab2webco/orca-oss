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
