import { describe, expect, it } from 'vitest'
import { teamSceneActors } from './team-scene-actors'
import {
  applyTeamSceneInput,
  createTeamSceneWorld,
  drainTeamSceneEffects,
  settleTeamScene,
  stepTeamScene,
  type TeamSceneWorld
} from './team-scene-director'
import { TEAM_STEWARD_NAME } from '../team-panel-steward'
import { stewardSaysOf } from './team-scene-steward-visit'
import type {
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneInput,
  TeamSceneMemberInput,
  TeamSceneStewardMove
} from './team-scene-types'

// ORCA-1242: the Orca steward visits a member when it raises or lowers its model, and says why.
const DT = 1 / 30
const OFFICE = { rowSize: 5, workSeated: true, firstX: 0.16, rowGrows: true }
const raise: TeamSceneStewardMove = { at: 1, lift: 'raise', to: 'Opus 5.5 · high', moment: 'edit' }
const member = (key: string, steward?: TeamSceneStewardMove): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  site: { stage: 0, broken: false },
  ...(steward ? { steward } : {})
})
const input = (members: TeamSceneMemberInput[], extra: Partial<TeamSceneInput> = {}) => ({
  lead: { key: 'lead', name: 'Alfred', characterKey: null, activity: 'resting' as const },
  advisor: null,
  members,
  ...extra
})
const stewardOf = (world: TeamSceneWorld): TeamSceneActor | undefined =>
  teamSceneActors(world).find((a) => a.role === 'steward')

function run(world: TeamSceneWorld, seconds: number, width: number, until?: () => boolean) {
  const effects: TeamSceneEffect[] = []
  for (let t = 0; t < seconds && !until?.(); t += DT) {
    stepTeamScene(world, DT, { width })
    effects.push(...drainTeamSceneEffects(world))
  }
  return effects
}

type Layout = Parameters<typeof applyTeamSceneInput>[2]

function moved(members: TeamSceneMemberInput[], extra = {}, layout: Layout = OFFICE) {
  const world = createTeamSceneWorld()
  const before = members.map((m) => member(m.key))
  applyTeamSceneInput(world, input(before, extra), layout)
  run(world, 1, 640)
  applyTeamSceneInput(world, input(members, extra), layout)
  return world
}

describe('the Orca steward in the scene', () => {
  it('is not on stage until it moves a member', () => {
    const world = moved([member('a'), member('b')])
    expect(stewardOf(world)).toBeUndefined()
    expect(stewardSaysOf(world)).toBeNull()
  })

  for (const width of [220, 640]) {
    it(`walks in from the stage edge, raises beside the member with its move, then puffs out, at ${width} px`, () => {
      const world = moved([member('a'), member('b', raise), member('c')])
      const entry = run(world, 2 * DT, width)
      const entered = stewardOf(world)
      expect(entered?.x === undefined ? null : Math.min(entered.x, 1 - entered.x)).toBeLessThan(0.1)
      expect(entry).toContainEqual(expect.objectContaining({ kind: 'burst', key: 'steward' }))
      run(world, 8, width, () => stewardSaysOf(world) !== null)
      const steward = stewardOf(world)!
      const desk = world.bodies.get('b')!.home.x
      expect(Math.abs(steward.x - desk) * width).toBeLessThan(0.1 * width + 2)
      expect(steward).toMatchObject({ pose: 'raise', gesture: 'raised', name: TEAM_STEWARD_NAME })
      expect(stewardSaysOf(world)).toEqual({ key: 'b', move: raise })
      const gone = run(world, 6, width, () => stewardOf(world) === undefined)
      expect(stewardOf(world)).toBeUndefined()
      expect(stewardSaysOf(world)).toBeNull()
      expect(gone).toContainEqual(
        expect.objectContaining({ kind: 'burst', key: 'steward', reason: 'puff' })
      )
    })
  }

  // Why: from the back aisle the member hid it wherever the row was tight.
  for (const layout of [undefined, OFFICE]) {
    it(`stands in front of the member, half a body aside, in a narrow row, ${layout ? 'seated' : 'standing'}`, () => {
      const world = moved([member('a', raise), member('b'), member('c'), member('d')], {}, layout)
      run(world, 8, 220, () => stewardSaysOf(world) !== null)
      const [steward, seat] = [stewardOf(world)!, world.bodies.get('a')!.home]
      const clear = steward.depth > seat.depth && Math.abs(steward.x - seat.x) * 220 >= 12
      expect(clear, `${steward.x}@${steward.depth} by ${seat.x}@${seat.depth}`).toBe(true)
    })
  }

  it('shows a lowered pick with the lowered gesture', () => {
    const world = moved([member('a', { ...raise, lift: 'lower', to: 'Haiku 5.5 · low' })])
    run(world, 8, 640, () => stewardSaysOf(world) !== null)
    expect(stewardOf(world)?.gesture).toBe('lowered')
  })

  it('visits each member it moved in one poll, one after the other', () => {
    const world = moved([member('a', raise), member('b', { ...raise, at: 2 })])
    const told: string[] = []
    run(world, 20, 640, () => {
      const says = stewardSaysOf(world)?.key
      if (says && told.at(-1) !== says) {
        told.push(says)
      }
      return false
    })
    expect(told).toEqual(['a', 'b'])
  })

  it('visits a floor the lead does not stand on', () => {
    const world = moved([member('a', raise)], { leadless: true })
    run(world, 8, 640, () => stewardSaysOf(world) !== null)
    expect(stewardSaysOf(world)?.key).toBe('a')
  })

  it('leaves when the member it walks to is gone, and under reduced motion never shows', () => {
    const world = moved([member('a', raise)])
    run(world, 0.3, 640)
    applyTeamSceneInput(world, input([]), OFFICE)
    run(world, 2, 640)
    expect(stewardOf(world)).toBeUndefined()
    const walking = moved([member('a', raise)])
    run(walking, 0.5, 640)
    expect(stewardOf(walking)).toBeDefined()
    settleTeamScene(walking)
    expect(stewardOf(walking)).toBeUndefined()
    const queued = moved([member('a', raise)])
    settleTeamScene(queued)
    run(queued, 1, 640)
    expect(stewardOf(queued)).toBeUndefined()
    expect(stewardSaysOf(queued)).toBeNull()
  })
})
