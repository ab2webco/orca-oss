import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TeamSceneFloorLegs } from '../../../../shared/team-scene/team-scene-floors'
import {
  RIDE_BOARD_LIMIT_SECONDS,
  RIDE_TRAVEL_SECONDS,
  teamSceneLegAfter,
  type TeamSceneLeg,
  type TeamSceneLegWant
} from '../../../../shared/team-scene/team-scene-ride-legs'

type Rider = keyof TeamSceneFloorLegs
type Wants = Record<Rider, TeamSceneLegWant>

const HOME: TeamSceneFloorLegs = { lead: { stage: 'home' }, advisor: { stage: 'home' } }
const NO_FLOORS: ReadonlySet<string> = new Set()

/** A rider walking to the door on a floor nobody sees: there are no frames to walk it there. */
const walksUnseen = (leg: TeamSceneLeg, hidden: ReadonlySet<string>): boolean =>
  (leg.stage === 'out' && hidden.has(leg.home)) || (leg.stage === 'back' && hidden.has(leg.away))
const nowSeconds = (): number => Date.now() / 1000

// Why the end at once: under reduced motion nobody walks to a door, so a ride only shows its end.
const settled = (want: TeamSceneLegWant, home: string): TeamSceneLeg =>
  want ? { stage: 'there', home, away: want.floor, member: want.member, at: 0 } : { stage: 'home' }

/** Seconds until a stage can move on by the clock alone: the car's travel, or the board limit. */
const waitOf = (leg: TeamSceneLeg, now: number): number | null => {
  if (leg.stage === 'travel' || leg.stage === 'return') {
    return Math.max(0, leg.at + RIDE_TRAVEL_SECONDS - now)
  }
  if (leg.stage === 'out' || leg.stage === 'back') {
    return Math.max(0, leg.at + RIDE_BOARD_LIMIT_SECONDS - now)
  }
  return null
}

/**
 * The lead's and advisor's trips through the building: each walks to the elevator, the car leaves
 * once it boards (or after a limit when the scene is not drawn), and it arrives on the other floor.
 */
export function useTeamSceneRideLegs(
  wants: Wants,
  home: string,
  reducedMotion: boolean,
  /** Floors out of view: they draw no frames, so a rider walking out there boards at once. */
  hidden: ReadonlySet<string> = NO_FLOORS
): { legs: TeamSceneFloorLegs; onBoarded: (rider: string) => void } {
  const [legs, setLegs] = useState<TeamSceneFloorLegs>(HOME)
  // Why a tick: a timer that fires a hair early leaves legs unchanged, and must still set the next one.
  const [tick, setTick] = useState(0)
  const wantsRef = useRef(wants)
  const hiddenRef = useRef(hidden)
  // Why in a layout effect: render stays pure, and it runs before the effects that advance a trip.
  useLayoutEffect(() => {
    wantsRef.current = wants
    hiddenRef.current = hidden
  })
  const advance = useCallback(
    (boarded: string | null) =>
      setLegs((prev) => {
        const now = nowSeconds()
        const after = (leg: TeamSceneLeg, rider: Rider, boards: boolean): TeamSceneLeg =>
          teamSceneLegAfter(leg, { want: wantsRef.current[rider], now, home, boarded: boards })
        // Why twice: a rider setting out from a floor out of view boards the moment it sets out.
        const step = (rider: Rider): TeamSceneLeg => {
          const next = after(prev[rider], rider, boarded === rider)
          return walksUnseen(next, hiddenRef.current) ? after(next, rider, true) : next
        }
        const next = { lead: step('lead'), advisor: step('advisor') }
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
      }),
    [home]
  )
  const wantsKey = JSON.stringify([wants, [...hidden]])
  useEffect(() => {
    if (!reducedMotion) {
      advance(null)
    }
  }, [wantsKey, advance, reducedMotion])
  useEffect(() => {
    const now = nowSeconds()
    const waits = [waitOf(legs.lead, now), waitOf(legs.advisor, now)].filter(
      (wait): wait is number => wait !== null
    )
    if (reducedMotion || waits.length === 0) {
      return
    }
    const timer = setTimeout(
      () => {
        advance(null)
        setTick((one) => one + 1)
      },
      Math.round(Math.min(...waits) * 1000)
    )
    return () => clearTimeout(timer)
  }, [legs, tick, advance, reducedMotion])
  const onBoarded = useCallback((rider: string) => advance(rider), [advance])
  if (reducedMotion) {
    return {
      legs: { lead: settled(wants.lead, home), advisor: settled(wants.advisor, home) },
      onBoarded
    }
  }
  return { legs, onBoarded }
}
