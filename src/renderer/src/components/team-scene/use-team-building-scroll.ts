import { useCallback, useEffect, useRef } from 'react'

/**
 * Keeps the floor that matters in view in a building that scrolls inside: on first paint the
 * floor where someone needs you, else the lead's; later, the floor the elevator car moves to.
 */
export function useTeamBuildingScroll(args: {
  /** The floor to open on: where someone needs you, else the lead's. */
  openOn: string
  /** Where the car stands; a ride to a floor out of view brings it into view. */
  carAt: string
  reducedMotion: boolean
}): (key: string) => (el: HTMLElement | null) => void {
  const floors = useRef(new Map<string, HTMLElement>())
  const opened = useRef(false)
  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) {
        floors.current.set(key, el)
      } else {
        floors.current.delete(key)
      }
    },
    []
  )
  const { openOn, carAt, reducedMotion } = args
  useEffect(() => {
    const el = floors.current.get(openOn)
    if (!opened.current && el) {
      opened.current = true
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [openOn])
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
  }, [carAt, reducedMotion])
  return register
}
