import { describe, expect, it } from 'vitest'
import {
  applyTeamSceneInput,
  createTeamSceneWorld,
  drainTeamSceneEffects,
  settleTeamScene,
  stepTeamScene,
  type TeamSceneWorld
} from './team-scene-director'
import { teamSceneActors } from './team-scene-actors'
import { teamSceneLeadAttends } from './team-scene-lead-rounds'
import type {
  TeamSceneActivity,
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneInput,
  TeamSceneMemberInput
} from './team-scene-types'

const WIDTH = 360
const DT = 1 / 30
const member = (key: string, activity: TeamSceneActivity = 'working'): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity,
  reportId: null,
  mergedPr: null,
  site: { stage: 0, broken: false }
})
const input = (
  members: TeamSceneMemberInput[],
  leadActivity: TeamSceneActivity = 'working'
): TeamSceneInput => ({
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: leadActivity },
  advisor: null,
  members
})
const actor = (world: TeamSceneWorld, key: string): TeamSceneActor =>
  teamSceneActors(world).find((a) => a.key === key)!

/** Steps the scene, keeping every effect it emits, until `done` or the time runs out. */
function run(
  world: TeamSceneWorld,
  seconds: number,
  done: () => boolean = () => false
): TeamSceneEffect[] {
  const seen: TeamSceneEffect[] = []
  for (let t = 0; t < seconds; t += DT) {
    stepTeamScene(world, DT, { width: WIDTH })
    seen.push(...drainTeamSceneEffects(world))
    if (done()) {
      break
    }
  }
  return seen
}

const leadWalking = (world: TeamSceneWorld): boolean => Math.abs(world.bodies.get('lead')!.v) > 3

const handsTo = (effects: TeamSceneEffect[]): string[] =>
  effects.flatMap((e) => (e.kind === 'handoff' && e.from === 'lead' ? [e.to] : []))

function scene(members: TeamSceneMemberInput[]): TeamSceneWorld {
  const world = createTeamSceneWorld()
  applyTeamSceneInput(world, input(members))
  return world
}

describe('team scene lead rounds', () => {
  // ORCA-1336: the lead moves only for a real event, as in the 3D Office (ORCA-1317).
  it('a working lead with no asker and no send never leaves its spot', () => {
    for (const members of [[member('a')], [member('a'), member('b'), member('c')], []]) {
      const world = scene(members)
      const home = actor(world, 'lead').x
      let walked = false
      const effects = run(world, 40, () => {
        walked ||= leadWalking(world) || world.rounds.stage !== 'rest'
        return false
      })
      expect(walked).toBe(false)
      expect(handsTo(effects)).toEqual([])
      expect(actor(world, 'lead').x).toBe(home)
      expect(actor(world, 'lead').pose).not.toBe('give')
      expect(actor(world, 'lead').carrying).toBe(false)
    }
  })

  it('takes a member report at its spot: the visitor walks up to the lead', () => {
    const world = scene([member('a'), member('b')])
    run(world, 2)
    applyTeamSceneInput(world, input([{ ...member('a'), reportId: 'r1' }, member('b')]))
    const effects = run(
      world,
      20,
      () => actor(world, 'lead').pose === 'give' && world.visitor === 'a'
    )
    expect(effects).toContainEqual({ kind: 'handoff', from: 'a', to: 'lead' })
  })

  it('walks to a member who needs you and stays with it while it asks', () => {
    const world = scene([member('a'), member('b', 'needsYou')])
    const nearB = () => Math.abs(actor(world, 'lead').x - actor(world, 'b').x) < 0.12
    expect(handsTo(run(world, 15, () => nearB() && !leadWalking(world)))).toEqual([])
    expect(nearB()).toBe(true)
    expect(handsTo(run(world, 10))).toEqual([])
    expect(nearB()).toBe(true)
    expect(actor(world, 'lead').facing).toBe(actor(world, 'b').x < actor(world, 'lead').x ? -1 : 1)
    expect(actor(world, 'b').emote).toBe('alert')
  })

  it('walks home once the member is answered', () => {
    const world = scene([member('b', 'needsYou')])
    const home = actor(world, 'lead').x
    run(world, 15, () => Math.abs(actor(world, 'lead').x - actor(world, 'b').x) < 0.12)
    applyTeamSceneInput(world, input([member('b', 'resting')]))
    run(world, 15, () => actor(world, 'lead').x === home)
    expect(actor(world, 'lead').x).toBe(home)
  })

  // Why (owner, #1167): the lead travels to whoever needs you even when it is not working itself.
  it('a lead that is not working hands nothing, yet still goes to a member who needs you', () => {
    for (const activity of ['resting', 'done', 'needsYou'] as const) {
      const world = createTeamSceneWorld()
      applyTeamSceneInput(world, input([member('a'), member('b', 'needsYou')], activity))
      const nearB = () => Math.abs(actor(world, 'lead').x - actor(world, 'b').x) < 0.12
      expect(handsTo(run(world, 20, () => nearB() && !leadWalking(world))), activity).toEqual([])
      expect(nearB(), activity).toBe(true)
      expect(actor(world, 'lead').pose).not.toBe('give')
    }
  })

  it('a lead that cannot work stays at its spot, as its card says', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([member('a'), member('b', 'needsYou')], 'blocked'))
    const home = actor(world, 'lead').x
    expect(handsTo(run(world, 20))).toEqual([])
    expect(actor(world, 'lead').x).toBe(home)
  })

  it('a lead that is not working stays at its spot when nobody needs you', () => {
    for (const activity of ['resting', 'done'] as const) {
      const world = createTeamSceneWorld()
      applyTeamSceneInput(world, input([member('a'), member('b')], activity))
      const home = actor(world, 'lead').x
      expect(handsTo(run(world, 20)), activity).toEqual([])
      expect(actor(world, 'lead').x, activity).toBe(home)
    }
  })

  it('reduced motion settles the lead at home', () => {
    const world = scene([member('a', 'needsYou')])
    const home = actor(world, 'lead').x
    run(world, 6, () => leadWalking(world))
    settleTeamScene(world)
    expect(actor(world, 'lead').x).toBe(home)
    expect(actor(world, 'lead').carrying).toBe(false)
  })
})

// Why: its bubble may tail behind the asker's tag on the way there too, or it vanishes mid-walk
// (merge-queue run 42982825235, 'bubbles shown: none' beside ORCA-14's tag).
describe('teamSceneLeadAttends', () => {
  it('holds from the moment the lead sets out to a member who asks until it is answered', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([member('a', 'needsYou')]))
    stepTeamScene(world, DT, { width: WIDTH })
    expect(world.rounds.stage).toBe('toMember')
    expect(teamSceneLeadAttends(world)).toBe(true)
    for (let t = 0; t < 20; t += DT) {
      stepTeamScene(world, DT, { width: WIDTH })
    }
    expect(world.rounds.stage).toBe('atMember')
    expect(teamSceneLeadAttends(world)).toBe(true)
    applyTeamSceneInput(world, input([member('a')]))
    stepTeamScene(world, DT, { width: WIDTH })
    expect(teamSceneLeadAttends(world)).toBe(false)
  })

  it('never holds with nobody asking', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([member('a')]))
    for (let t = 0; t < 4; t += DT) {
      stepTeamScene(world, DT, { width: WIDTH })
      expect(teamSceneLeadAttends(world)).toBe(false)
    }
  })
})

// ORCA-1204: easing back to its spot's depth while still over the desks drew the lead behind them.
describe('the lead walking home', () => {
  // Where the Office image painter splits the actors drawn behind the row from those in front.
  const BEHIND_ROW = 0.05
  const DESK_HALF = 0.06

  for (const width of [220, 640]) {
    it(`stays in front of the desk row while over it, at ${width} px`, () => {
      const world = createTeamSceneWorld()
      const keys = ['a', 'b', 'c', 'd', 'e']
      applyTeamSceneInput(world, input(keys.map((k) => member(k))), {
        rowSize: 5,
        workSeated: true,
        firstX: 0.16,
        rowGrows: true
      })
      // Why c asks on and off: the lead walks only to an asker, and home once answered.
      const asking = (on: boolean) =>
        applyTeamSceneInput(
          world,
          input(keys.map((k) => member(k, on && k === 'c' ? 'needsYou' : 'working'))),
          { rowSize: 5, workSeated: true, firstX: 0.16, rowGrows: true }
        )
      const row = Math.min(...world.stations.map((s) => s.depth)) - BEHIND_ROW
      const left = Math.min(...world.stations.map((s) => s.x)) - DESK_HALF
      const right = Math.max(...world.stations.map((s) => s.x)) + DESK_HALF
      const lead = world.bodies.get('lead')!
      let returns = 0
      let wasOut = false
      // Why 12 s a phase: at 640 px each way takes longer than 6 s.
      for (let frame = 0; frame < 120 / DT; frame++) {
        if (frame % 360 === 0) {
          asking(frame % 720 === 0)
        }
        stepTeamScene(world, DT, { width })
        const out = world.rounds.stage !== 'rest'
        if (wasOut && !out) {
          returns++
        }
        wasOut = out
        if (lead.x > left && lead.x < right) {
          expect(
            lead.depth,
            `lead behind the row at x ${lead.x.toFixed(3)}`
          ).toBeGreaterThanOrEqual(row)
        }
      }
      expect(returns, 'the lead never came home from a round').toBeGreaterThan(1)
    })
  }
})
