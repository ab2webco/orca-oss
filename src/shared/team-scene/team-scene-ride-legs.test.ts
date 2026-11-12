import { describe, expect, it } from 'vitest'
import {
  RIDE_BOARD_LIMIT_SECONDS,
  RIDE_TRAVEL_SECONDS,
  teamSceneLegAfter,
  teamSceneLegCar,
  type TeamSceneLeg
} from './team-scene-ride-legs'

const HOME: TeamSceneLeg = { stage: 'home' }
const want = { floor: 'imac', member: 'herrero' }

describe('teamSceneLegAfter, one rider between two floors', () => {
  it('walks out, waits at the door until the rider boards, travels, and arrives', () => {
    const out = teamSceneLegAfter(HOME, { want, now: 0, home: '', boarded: false })
    expect(out).toMatchObject({ stage: 'out', home: '', away: 'imac', member: 'herrero' })
    // Not boarded yet: the car waits.
    expect(teamSceneLegAfter(out, { want, now: 3, home: '', boarded: false }).stage).toBe('out')
    const travel = teamSceneLegAfter(out, { want, now: 3, home: '', boarded: true })
    expect(travel).toMatchObject({ stage: 'travel', at: 3 })
    expect(teamSceneLegAfter(travel, { want, now: 3.5, home: '', boarded: false }).stage).toBe(
      'travel'
    )
    expect(
      teamSceneLegAfter(travel, { want, now: 3 + RIDE_TRAVEL_SECONDS, home: '', boarded: false })
        .stage
    ).toBe('there')
  })

  it('travels anyway once the walk-out runs past its limit, as on a scene that is not drawn', () => {
    const out = teamSceneLegAfter(HOME, { want, now: 0, home: '', boarded: false })
    const late = { want, now: RIDE_BOARD_LIMIT_SECONDS, home: '', boarded: false }
    expect(teamSceneLegAfter(out, late).stage).toBe('travel')
  })

  it('goes back the same way when it is no longer wanted, and is home only on arrival', () => {
    const there: TeamSceneLeg = { stage: 'there', home: '', away: 'imac', member: 'herrero', at: 5 }
    const back = teamSceneLegAfter(there, { want: null, now: 9, home: '', boarded: false })
    expect(back.stage).toBe('back')
    const going = teamSceneLegAfter(back, { want: null, now: 10, home: '', boarded: true })
    expect(going.stage).toBe('return')
    expect(
      teamSceneLegAfter(going, {
        want: null,
        now: 10 + RIDE_TRAVEL_SECONDS,
        home: '',
        boarded: false
      })
    ).toEqual({ stage: 'home', returned: true })
  })

  it('turns back on arrival when the reason ended while the car travelled', () => {
    const travel: TeamSceneLeg = { stage: 'travel', home: '', away: 'imac', member: null, at: 0 }
    const now = RIDE_TRAVEL_SECONDS
    expect(teamSceneLegAfter(travel, { want: null, now, home: '', boarded: false })).toMatchObject({
      stage: 'back',
      at: now
    })
  })

  it('never leaves when the reason ends before the rider boards', () => {
    const out = teamSceneLegAfter(HOME, { want, now: 0, home: '', boarded: false })
    expect(teamSceneLegAfter(out, { want: null, now: 1, home: '', boarded: false })).toEqual({
      stage: 'home',
      returned: true
    })
  })
})

describe('teamSceneLegCar', () => {
  it('stands at home until the rider boards, carries it on both trips, and rests where it is', () => {
    const leg = (stage: TeamSceneLeg['stage']) =>
      ({ stage, home: '', away: 'imac', member: 'herrero', at: 0 }) as TeamSceneLeg
    expect(teamSceneLegCar(HOME, '')).toEqual({ at: '', rider: false })
    expect(teamSceneLegCar(leg('out'), '')).toEqual({ at: '', rider: false })
    expect(teamSceneLegCar(leg('travel'), '')).toEqual({ at: 'imac', rider: true })
    expect(teamSceneLegCar(leg('there'), '')).toEqual({ at: 'imac', rider: false })
    expect(teamSceneLegCar(leg('back'), '')).toEqual({ at: 'imac', rider: false })
    expect(teamSceneLegCar(leg('return'), '')).toEqual({ at: '', rider: true })
  })
})

describe('the boarding limit', () => {
  // Why: at 32 px/s a walk across a 900 px zoomed floor takes 28 s; the car must never leave a walker.
  it('outlasts a walk across the widest floor the panel draws', () => {
    expect(RIDE_BOARD_LIMIT_SECONDS).toBeGreaterThanOrEqual((900 * 1) / 32)
  })
})
