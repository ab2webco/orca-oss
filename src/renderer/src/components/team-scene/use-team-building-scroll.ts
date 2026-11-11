import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

type Floors = RefObject<Map<string, HTMLElement>>
const NONE: ReadonlySet<string> = new Set()

/**
 * The building's floor elements, and which of them are out of view: a floor scrolled away draws
 * no frames, so a ride must not wait there for a walk nobody sees.
 */
export function useTeamFloorViews(): {
  floors: Floors
  register: (key: string) => (el: HTMLElement | null) => void
  hidden: ReadonlySet<string>
} {
  const floors = useRef(new Map<string, HTMLElement>())
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NONE)
  const observer = useRef<IntersectionObserver | null>(null)
  if (observer.current === null && typeof IntersectionObserver === 'function') {
    observer.current = new IntersectionObserver((entries) =>
      setHidden((old) => {
        const next = new Set(old)
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.teamFloor
          if (key !== undefined) {
            if (entry.isIntersecting) {
              next.delete(key)
            } else {
              next.add(key)
            }
          }
        }
        // Why by size and members: the lead's floor key is '', which a joined string would lose.
        return next.size === old.size && [...next].every((key) => old.has(key)) ? old : next
      })
    )
  }
  useEffect(() => () => observer.current?.disconnect(), [])
  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      const before = floors.current.get(key)
      if (before && before !== el) {
        observer.current?.unobserve(before)
      }
      if (el) {
        floors.current.set(key, el)
        observer.current?.observe(el)
      } else {
        floors.current.delete(key)
      }
    },
    []
  )
  return { floors, register, hidden }
}

/**
 * Keeps the floor that matters in view in a building that scrolls inside: on first paint the
 * floor where someone needs you, else the lead's; later, the floor the elevator car moves to.
 */
export function useTeamBuildingScroll(args: {
  floors: Floors
  /** The floor to open on: where someone needs you, else the lead's. */
  openOn: string
  /** Where the car stands; a ride to a floor out of view brings it into view. */
  carAt: string
  reducedMotion: boolean
}): void {
  const { floors, openOn, carAt, reducedMotion } = args
  const opened = useRef(false)
  useEffect(() => {
    const el = floors.current.get(openOn)
    if (!opened.current && el) {
      opened.current = true
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [floors, openOn])
  const lastCar = useRef(carAt)
  useEffect(() => {
    if (!opened.current || lastCar.current === carAt) {
      lastCar.current = carAt
      return
    }
    lastCar.current = carAt
    floors.current
      .get(carAt)
      ?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [floors, carAt, reducedMotion])
}
