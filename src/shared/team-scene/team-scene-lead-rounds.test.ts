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
  mergedPr: null
})
const input = (members: TeamSceneMemberInput[]): TeamSceneInput => ({
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
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
  it('walks to a working member, hands it work, and walks back', () => {
    const world = scene([member('a')])
    const home = actor(world, 'lead').x
    const effects = run(world, 12, () => actor(world, 'lead').pose === 'give')
    expect(handsTo(effects)).toEqual(['a'])
    expect(Math.abs(actor(world, 'lead').x - actor(world, 'a').x)).toBeLessThan(0.12)
    expect(actor(world, 'lead').pose).toBe('give')
    expect(actor(world, 'a').emote).toBe('check')
    run(world, 15, () => actor(world, 'lead').x === home)
    expect(actor(world, 'lead').x).toBe(home)
  })

  it('carries the work on the way out', () => {
    const world = scene([member('a')])
    run(world, 6, () => leadWalking(world))
    expect(actor(world, 'lead').carrying).toBe(true)
  })

  it('visits every working member in turn', () => {
    const world = scene([member('a'), member('b'), member('c')])
    expect(handsTo(run(world, 40))).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect(handsTo(run(world, 0)).length).toBe(0)
  })

  it('skips members that are not working', () => {
    const world = scene([member('a', 'resting'), member('b'), member('c', 'done')])
    expect(new Set(handsTo(run(world, 30)))).toEqual(new Set(['b']))
  })

  it('stays home when nobody is working', () => {
    const world = scene([member('a', 'resting')])
    const home = actor(world, 'lead').x
    expect(handsTo(run(world, 15))).toEqual([])
    expect(actor(world, 'lead').x).toBe(home)
  })

  it('turns back when the member it walks to stops working', () => {
    const world = scene([member('a')])
    const home = actor(world, 'lead').x
    run(world, 6, () => leadWalking(world))
    applyTeamSceneInput(world, input([member('a', 'resting')]))
    expect(handsTo(run(world, 10))).toEqual([])
    expect(actor(world, 'lead').x).toBe(home)
  })

  it('lets a member report first: the lead is home when a visitor walks up', () => {
    const world = scene([member('a'), member('b')])
    run(world, 6, () => leadWalking(world))
    applyTeamSceneInput(world, input([{ ...member('a'), reportId: 'r1' }, member('b')]))
    const effects = run(
      world,
      20,
      () => actor(world, 'lead').pose === 'give' && world.visitor === 'a'
    )
    expect(effects).toContainEqual({ kind: 'handoff', from: 'a', to: 'lead' })
  })

  it('reduced motion settles the lead at home', () => {
    const world = scene([member('a')])
    const home = actor(world, 'lead').x
    run(world, 6, () => leadWalking(world))
    settleTeamScene(world)
    expect(actor(world, 'lead').x).toBe(home)
    expect(actor(world, 'lead').carrying).toBe(false)
  })
})
