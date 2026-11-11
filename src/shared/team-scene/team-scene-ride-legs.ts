/** How long the car takes between two floors with its rider. */
export const RIDE_TRAVEL_SECONDS = 1.2
// Why a limit: a scene that is not drawn (hidden, off screen) never walks its rider to the door.
export const RIDE_BOARD_LIMIT_SECONDS = 8

/**
 * One rider's trip between its home floor and another: out to the elevator, the car's travel,
 * the stay there, back to the elevator, and the return. `at` is when the stage began.
 */
export type TeamSceneLeg =
  | { stage: 'home'; returned?: true }
  | {
      stage: 'out' | 'travel' | 'there' | 'back' | 'return'
      home: string
      away: string
      member: string | null
      at: number
    }

export type TeamSceneLegWant = { floor: string; member: string | null } | null

/** The next stage of a trip, from what is wanted now, the clock, and whether the rider boarded. */
export function teamSceneLegAfter(
  leg: TeamSceneLeg,
  {
    want,
    now,
    home,
    boarded
  }: { want: TeamSceneLegWant; now: number; home: string; boarded: boolean }
): TeamSceneLeg {
  if (leg.stage === 'home') {
    return want ? { stage: 'out', home, away: want.floor, member: want.member, at: now } : leg
  }
  const next = (stage: Exclude<TeamSceneLeg['stage'], 'home'>): TeamSceneLeg => ({
    ...leg,
    stage,
    at: now
  })
  // Why a hair of slack: the timers that wake this fire at the boundary, in float seconds.
  const past = (seconds: number) => now - leg.at >= seconds - 1e-6
  const boards = boarded || past(RIDE_BOARD_LIMIT_SECONDS)
  const arrives = past(RIDE_TRAVEL_SECONDS)
  switch (leg.stage) {
    case 'out':
      if (want?.floor !== leg.away) {
        return { stage: 'home', returned: true }
      }
      return boards ? next('travel') : leg
    case 'travel':
      return arrives ? next('there') : leg
    case 'there':
      return want?.floor === leg.away ? leg : next('back')
    case 'back':
      return boards ? next('return') : leg
    case 'return':
      return arrives ? { stage: 'home', returned: true } : leg
  }
}

/** Where the car stands for a trip, and whether it carries the rider now. */
export function teamSceneLegCar(leg: TeamSceneLeg, home: string): { at: string; rider: boolean } {
  switch (leg.stage) {
    case 'home':
    case 'out':
      return { at: home, rider: false }
    case 'travel':
      return { at: leg.away, rider: true }
    case 'there':
    case 'back':
      return { at: leg.away, rider: false }
    case 'return':
      return { at: home, rider: true }
  }
}
