import { describe, expect, it } from 'vitest'
import type { TeamHost, TeamMemberCard } from '../team-panel-model-types'
import { dioramaPaceOf } from './team-diorama-lead-round'
import { bookOffice3dCab, office3dCab, office3dCabFloorAt } from './team-office3d-elevator'
import {
  OFFICE3D_CALL,
  OFFICE3D_CALL_PANEL,
  OFFICE3D_DEPTH,
  OFFICE3D_DOOR_Z,
  OFFICE3D_SEAT_Z,
  OFFICE3D_WING_WIDTH,
  teamOffice3dLayoutOf,
  type Office3dFloor,
  type Office3dPoint
} from './team-office3d-layout'
import { office3dCommuteOf, office3dLeadRoundOf, office3dWalkerAt } from './team-office3d-walkers'
import type { TeamSceneFloor } from './team-scene-floors'

const card = (paneKey: string) => ({ paneKey }) as unknown as TeamMemberCard
const host = (name: string): TeamHost =>
  name ? { kind: 'remote', name, environmentId: `env-${name}`, reachable: true } : { kind: 'local' }
const floor = (
  key: string,
  keys: string[],
  over: Partial<TeamSceneFloor> = {}
): TeamSceneFloor => ({
  key,
  host: host(key),
  members: keys.map(card),
  cap: 5,
  running: keys.length,
  reachable: true,
  lead: key === '',
  taken: 0,
  free: 5 - keys.length,
  ...over
})
const layout = (...floors: TeamSceneFloor[]) => teamOffice3dLayoutOf(floors, { leadAdvisor: true })
const building = () => layout(floor('', ['a', 'b']), floor('m2', ['c']), floor('gpu', ['d']))

const talksOf = (round: ReturnType<typeof office3dLeadRoundOf>) =>
  round.steps.flatMap((s) =>
    s.kind === 'hold' && (s.pose === 'talk' || s.pose === 'give') ? [[s.floor, s.pose]] : []
  )

describe('the 3D Office lift', () => {
  it('comes to the caller first, then rides, and queues a second rider behind the first', () => {
    const cab = office3dCab(0)
    const first = bookOffice3dCab(cab, 2, 0, 0)
    expect(first.board).toBeGreaterThan(0)
    expect(office3dCabFloorAt(cab, first.board)).toBe(2)
    expect(office3dCabFloorAt(cab, first.arrive)).toBe(0)
    const second = bookOffice3dCab(cab, 0, 1, 0)
    expect(second.board).toBeGreaterThan(first.arrive)
  })

  it('rides faster at a faster pace', () => {
    const slow = bookOffice3dCab(office3dCab(0), 0, 2, 0, 1)
    const fast = bookOffice3dCab(office3dCab(0), 0, 2, 0, 2.5)
    expect(fast.arrive).toBeCloseTo(slow.arrive / 2.5)
  })
})

describe("the 3D Office lead's round", () => {
  it('answers askers first, one trip per floor, then a word with busy members on its own floor', () => {
    const round = office3dLeadRoundOf({
      layout: building(),
      needs: ['d', 'c', 'a'],
      visits: ['b', 'a'],
      pace: 'normal'
    })
    expect(talksOf(round)).toEqual([
      [2, 'talk'],
      [1, 'talk'],
      [0, 'talk'],
      [0, 'give']
    ])
    expect(round.steps.filter((s) => s.kind === 'ride')).toHaveLength(3)
    expect(round.steps.at(-1)).toMatchObject({ kind: 'hold', pose: 'desk', floor: 0 })
    expect(round.steps.every((s) => s.dur >= 0)).toBe(true)
    for (const [i, s] of round.steps.entries()) {
      if (s.kind === 'ride') {
        expect(round.steps[i - 1]).toMatchObject({ kind: 'hold', at: [-1.15, 4.1] })
      }
    }
  })

  it('skips a floor whose machine is unreachable and never visits another floor to hand work out', () => {
    const l = layout(
      floor('', ['a']),
      floor('m2', ['c'], { reachable: false }),
      floor('gpu', ['d'])
    )
    const round = office3dLeadRoundOf({
      layout: l,
      needs: ['c'],
      visits: ['d', 'a'],
      pace: 'normal'
    })
    expect(talksOf(round)).toEqual([[0, 'give']])
    expect(round.steps.some((s) => s.kind === 'ride')).toBe(false)
  })

  it('walks 2.5 times faster at Fast, and Direct jumps with no walk or ride', () => {
    const args = { layout: building(), needs: ['c'], visits: [] }
    const walking = (pace: string) =>
      office3dLeadRoundOf({ ...args, pace })
        .steps.filter((s) => s.kind === 'walk')
        .reduce((n, s) => n + s.dur, 0)
    expect(walking('fast')).toBeCloseTo(walking('normal') / 2.5)
    const direct = office3dLeadRoundOf({ ...args, pace: 'direct' })
    expect(direct.steps.map((s) => s.kind)).toEqual(['jump', 'hold', 'jump', 'hold'])
  })

  it('walks at normal for a pace it does not know', () => {
    expect(dioramaPaceOf('warp')).toEqual(dioramaPaceOf('normal'))
    const args = { layout: building(), needs: ['c'], visits: [] }
    expect(office3dLeadRoundOf({ ...args, pace: 'warp' }).total).toBe(
      office3dLeadRoundOf({ ...args, pace: 'normal' }).total
    )
  })

  it('is in the cab between floors while it rides, and back at its desk at the end', () => {
    const round = office3dLeadRoundOf({
      layout: building(),
      needs: ['c'],
      visits: [],
      pace: 'normal'
    })
    const ride = round.steps.find((s) => s.kind === 'ride')!
    const mid = office3dWalkerAt(round, ride.start + ride.dur / 2)
    expect(mid.floor).toBeGreaterThan(0)
    expect(mid.floor).toBeLessThan(1)
    expect(office3dWalkerAt(round, round.total - 0.01)).toMatchObject({ floor: 0, pose: 'desk' })
  })
})

describe('the 3D Office commute', () => {
  it('walks a member from its floor’s lift door to its desk, and back out when it leaves', () => {
    const l = building()
    const come = office3dCommuteOf({ layout: l, key: 'c', arriving: true, pace: 'normal' })!
    const go = office3dCommuteOf({ layout: l, key: 'c', arriving: false, pace: 'normal' })!
    const start = office3dWalkerAt(come, 0)
    expect(start.floor).toBe(1)
    expect(office3dWalkerAt(go, go.total - 0.001).at[0]).toBeCloseTo(start.at[0])
    expect(office3dCommuteOf({ layout: l, key: 'zz', arriving: true, pace: 'normal' })).toBeNull()
    expect(
      office3dCommuteOf({ layout: l, key: 'c', arriving: true, pace: 'direct' })!.steps[0]!.kind
    ).toBe('jump')
  })
})

// Footprints in floor coordinates, from the numbers the drawing uses (team-office3d-floor.ts,
// team-office3d-wing.ts, team-office3d-lift.ts); the lead's body is a circle of radius BODY.
type Rect = { name: string; x0: number; x1: number; z0: number; z1: number }
const BODY = 0.2
const solidsOf = (floor: Office3dFloor): Rect[] => {
  const r = (name: string, x: number, z: number, w: number, d: number): Rect => ({
    name,
    x0: x - w / 2,
    x1: x + w / 2,
    z0: z - d / 2,
    z1: z + d / 2
  })
  const k = floor.scale
  const out = floor.seats.flatMap((seat) => [
    r(`desk ${seat.x.toFixed(1)}`, seat.x, OFFICE3D_SEAT_Z - 0.95 * k, 2 * k, 1.1 * k),
    r(`chair ${seat.x.toFixed(1)}`, seat.x, OFFICE3D_SEAT_Z + 0.25 * k, 0.8 * k, 0.95 * k)
  ])
  // The side wall up to the lift door, and the door's leaves, solid unless the cab is here.
  out.push(r('side wall', -0.15, (OFFICE3D_DOOR_Z - 0.85) / 2, 0.3, OFFICE3D_DOOR_Z - 0.85))
  for (const px of [-2.25, -0.3]) {
    for (const pz of [OFFICE3D_DOOR_Z - 1, OFFICE3D_DOOR_Z + 1]) {
      out.push(r('shaft post', px, pz, 0.12, 0.12))
    }
  }
  if (floor.office) {
    const ox = floor.office.x
    out.push(r("lead's desk", ox + OFFICE3D_WING_WIDTH / 2, 2.6, 2.1, 0.95))
    out.push(r('bookshelf', ox + OFFICE3D_WING_WIDTH / 2 - 0.5, 0.3, 2.6, 0.42))
    for (const gx of [-0.65, 0.65]) {
      out.push(r('guest chair', ox + OFFICE3D_WING_WIDTH / 2 + gx, 3.85, 0.6, 0.6))
    }
    out.push(r('office glass', ox, 1.7, 0.1, 3.4))
    out.push(r('office glass', ox, (4.7 + OFFICE3D_DEPTH) / 2, 0.1, OFFICE3D_DEPTH - 4.7))
  }
  return out
}
const inside = (p: Office3dPoint, s: Rect) =>
  p[0] > s.x0 - BODY && p[0] < s.x1 + BODY && p[1] > s.z0 - BODY && p[1] < s.z1 + BODY

describe('the 3D Office lift call', () => {
  it('stops at the call panel, facing it, until the cab boards, before every ride', () => {
    const round = office3dLeadRoundOf({
      layout: building(),
      needs: ['d', 'c'],
      visits: [],
      pace: 'normal'
    })
    for (const [i, s] of round.steps.entries()) {
      if (s.kind !== 'ride') {
        continue
      }
      // Panel wait, the walk into the cab, the doors' wait inside it, then the ride.
      expect(round.steps[i - 3]).toMatchObject({
        kind: 'hold',
        at: OFFICE3D_CALL,
        face: OFFICE3D_CALL_PANEL
      })
      expect(round.steps[i - 2]).toMatchObject({ kind: 'walk' })
    }
  })
})

describe("the 3D Office lead's path", () => {
  const layouts = {
    one: () => layout(floor('', ['a', 'b'])),
    two: () => layout(floor('', ['a', 'b']), floor('m2', ['c'])),
    three: () => building()
  }
  const mixes = [
    { needs: [], visits: ['a', 'b'] },
    { needs: ['c', 'a'], visits: ['b'] },
    { needs: ['d', 'c', 'b'], visits: ['a'] }
  ]
  for (const [name, make] of Object.entries(layouts)) {
    for (const pace of ['normal', 'fast']) {
      it(`never walks through an object: ${name} floor(s), ${pace}`, () => {
        const l = make()
        for (const mix of mixes) {
          const round = office3dLeadRoundOf({ layout: l, ...mix, pace })
          for (let t = 0; t < round.total; t += 0.05) {
            const at = office3dWalkerAt(round, t)
            const fl = l.floors[Math.round(at.floor)]!
            if (Math.abs(at.floor - Math.round(at.floor)) > 0.01) {
              continue
            }
            const hit = solidsOf(fl).find((s) => inside(at.at, s))
            expect(hit, `${hit?.name} at t=${t.toFixed(2)} ${at.at}`).toBeUndefined()
            // Through the lift door only with the cab on this floor, so its leaves are open.
            if (at.at[0] < 0.2 && at.at[0] > -0.5) {
              expect(Math.round(office3dCabFloorAt(round.cab, t))).toBe(Math.round(at.floor))
            }
          }
        }
      })
    }
  }
})
