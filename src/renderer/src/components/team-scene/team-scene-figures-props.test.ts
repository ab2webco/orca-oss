import { describe, expect, it } from 'vitest'
import { seatPlanOf } from '../../../../shared/team-scene/team-scene-seats'
import { siteSpotOf } from '../../../../shared/team-scene/team-scene-sites'
import type { TeamSceneMemberInput } from '../../../../shared/team-scene/team-scene-types'
import { figuresPropsOf, figuresStaticArtOf } from './team-scene-figures-props'

// Why these widths: the Figures stage at a 1440 and a 390 window.
const WIDTHS = [349, 219]
const V30_X = { campfire: 0.075, anvil: 0.125, lectern: 0.655, flag: 0.9 }

function stageOf(count: number, building: boolean) {
  const members = Array.from(
    { length: count },
    (_, i) => ({ key: `m${i}`, activity: 'working' }) as TeamSceneMemberInput
  )
  const plan = seatPlanOf(members)
  const sites = building
    ? plan.seats.map((seat) => ({
        key: seat.key,
        stage: 3 as const,
        broken: false,
        spot: siteSpotOf(seat.spot)
      }))
    : []
  return { sites, stations: [...plan.seats.map((seat) => seat.spot), ...plan.empty] }
}

const overlaps = (a: { left: number; right: number }, b: { left: number; right: number }) =>
  a.left < b.right && b.left < a.right

// Why (ORCA-1150 C4): V30's props sit behind the actors, never on a castle site, pile or station.
describe('figuresPropsOf', () => {
  for (const width of WIDTHS) {
    for (const count of [0, 3, 9]) {
      for (const building of [true, false]) {
        it(`keeps every prop off the static art at ${width} px, ${count} members, builds ${building}`, () => {
          const stage = stageOf(count, building)
          const props = figuresPropsOf({ width, ...stage })
          const art = figuresStaticArtOf({ width, ...stage })
          for (const prop of props) {
            expect(prop.left).toBeGreaterThanOrEqual(0)
            expect(prop.right).toBeLessThanOrEqual(width)
            for (const box of art) {
              expect(overlaps(prop, box), `${prop.kind} on art at ${box.left}`).toBe(false)
            }
          }
        })
      }
    }
  }

  it('keeps each prop at its V30 place when nothing stands there', () => {
    const props = figuresPropsOf({ width: 349, sites: [], stations: [] })
    expect(props.map((prop) => prop.kind)).toEqual(['campfire', 'anvil', 'lectern', 'flag'])
    for (const prop of props) {
      expect(prop.x).toBeCloseTo(V30_X[prop.kind] * 349, 5)
    }
  })

  it('moves a prop off the static art by the least it can', () => {
    const stage = { width: 349, sites: [], stations: [{ x: 0.06, depth: 0.55 }] }
    const [art] = figuresStaticArtOf(stage)
    const home = V30_X.campfire * 349
    const campfire = figuresPropsOf(stage).find((p) => p.kind === 'campfire')!
    // Why only shifts that stay on stage: a prop never crosses the stage's left edge.
    const left = home + 13 - art.left
    const right = art.right - (home - 13)
    const least = Math.min(home - left - 13 >= 0 ? left : Infinity, right)
    expect(campfire.x).not.toBeCloseTo(home, 5)
    expect(Math.abs(campfire.x - home)).toBeLessThanOrEqual(Math.ceil(least))
  })
})
