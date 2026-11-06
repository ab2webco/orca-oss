import { describe, expect, it } from 'vitest'
import {
  advisorLineShown,
  applyTeamSceneInput,
  createTeamSceneWorld,
  drainTeamSceneEffects,
  settleTeamScene,
  stepTeamScene,
  type TeamSceneWorld
} from './team-scene-director'
import { teamSceneActors } from './team-scene-actors'
import type { TeamSceneActor, TeamSceneInput, TeamSceneMemberInput } from './team-scene-types'

const WIDTH = 360
const DT = 1 / 30
const lead = { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' } as const
const member = (key: string, extra: Partial<TeamSceneMemberInput> = {}): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  ...extra
})
const input = (members: TeamSceneMemberInput[], advisorLine?: string): TeamSceneInput => ({
  lead,
  advisor: advisorLine === undefined ? null : { line: advisorLine },
  members
})

const actor = (world: TeamSceneWorld, key: string): TeamSceneActor | undefined =>
  teamSceneActors(world).find((a) => a.key === key)

function runUntil(world: TeamSceneWorld, done: () => boolean, seconds = 30): boolean {
  for (let t = 0; t < seconds; t += DT) {
    stepTeamScene(world, DT, { width: WIDTH })
    if (done()) {
      return true
    }
  }
  return false
}

function seated(keys: string[]): TeamSceneWorld {
  const world = createTeamSceneWorld()
  applyTeamSceneInput(world, input(keys.map((k) => member(k))))
  return world
}

describe('team scene director', () => {
  it('places the first snapshot at its seats without an entrance', () => {
    const world = seated(['a', 'b'])
    expect(actor(world, 'a')?.pose).toBe('work')
    expect(actor(world, 'lead')?.role).toBe('lead')
    expect(actor(world, 'advisor')).toBeUndefined()
    expect(teamSceneActors(world).map((a) => a.depth)).toEqual(
      teamSceneActors(world)
        .map((a) => a.depth)
        .sort((p, q) => p - q)
    )
  })

  it('acts out each member state at its seat', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(
      world,
      input([
        member('w'),
        member('r', { activity: 'resting' }),
        member('q', { activity: 'needsYou' })
      ])
    )
    stepTeamScene(world, DT, { width: WIDTH })
    expect(actor(world, 'w')?.pose).toBe('work')
    expect(actor(world, 'r')?.pose).toBe('idle')
    expect(actor(world, 'q')).toMatchObject({ pose: 'raise', emote: 'alert' })
  })

  it('walks a new member in, greets it at the lead, then seats it', () => {
    const world = seated(['a'])
    applyTeamSceneInput(world, input([member('a'), member('n')]))
    expect(actor(world, 'n')?.x).toBeLessThan(0)
    expect(runUntil(world, () => actor(world, 'n')?.pose === 'walk')).toBe(true)
    expect(runUntil(world, () => actor(world, 'n')?.emote === 'heart')).toBe(true)
    expect(actor(world, 'lead')?.pose).toBe('wave')
    expect(runUntil(world, () => actor(world, 'n')?.pose === 'work')).toBe(true)
  })

  it('says goodbye at the lead and walks off stage', () => {
    const world = seated(['a', 'b'])
    applyTeamSceneInput(world, input([member('b')]))
    expect(runUntil(world, () => actor(world, 'a')?.emote === 'heart')).toBe(true)
    expect(runUntil(world, () => actor(world, 'a') === undefined)).toBe(true)
  })

  it('carries a report to the lead and hands it over', () => {
    const world = seated(['a'])
    drainTeamSceneEffects(world)
    applyTeamSceneInput(world, input([member('a', { reportId: 'r1' })]))
    expect(runUntil(world, () => actor(world, 'a')?.carrying === true)).toBe(true)
    expect(runUntil(world, () => actor(world, 'lead')?.pose === 'give')).toBe(true)
    expect(drainTeamSceneEffects(world)).toContainEqual({ kind: 'handoff', from: 'a', to: 'lead' })
    expect(runUntil(world, () => actor(world, 'a')?.pose === 'work')).toBe(true)
  })

  it('serializes visits so only one member stands at the lead', () => {
    const world = seated(['a', 'b'])
    applyTeamSceneInput(
      world,
      input([member('a', { reportId: 'x' }), member('b', { reportId: 'y' })])
    )
    let both = false
    runUntil(
      world,
      () => {
        both ||= actor(world, 'a')?.carrying === true && actor(world, 'b')?.carrying === true
        return false
      },
      12
    )
    expect(both).toBe(false)
  })

  it('cheers a merge for a moment, then goes back to work', () => {
    const world = seated(['a', 'b'])
    applyTeamSceneInput(world, input([member('a', { mergedPr: 7 }), member('b')]))
    stepTeamScene(world, DT, { width: WIDTH })
    expect(teamSceneActors(world).every((a) => a.pose === 'cheer')).toBe(true)
    expect(actor(world, 'a')?.emote).toBe('star')
    expect(runUntil(world, () => actor(world, 'b')?.pose === 'work', 4)).toBe(true)
  })

  it('advances the gait by the distance walked, so feet stay planted', () => {
    const world = seated(['a'])
    applyTeamSceneInput(world, input([member('a'), member('n')]))
    let last = actor(world, 'n')
    let walked = 0
    let gait = 0
    runUntil(world, () => {
      const now = actor(world, 'n')
      if (now && last && now.pose === 'walk') {
        walked += (Math.abs(now.x - last.x) * WIDTH) / now.stride
        gait += now.gait - last.gait
      }
      last = now
      return now?.emote === 'heart'
    })
    expect(walked).toBeGreaterThan(1)
    expect(gait / Math.PI).toBeCloseTo(walked, 0)
  })

  it('jumps straight to the end state under reduced motion', () => {
    const world = seated(['a'])
    applyTeamSceneInput(world, input([member('a'), member('n')]))
    settleTeamScene(world)
    expect(actor(world, 'n')?.pose).toBe('work')
    applyTeamSceneInput(world, input([member('n')]))
    settleTeamScene(world)
    expect(actor(world, 'a')).toBeUndefined()
  })

  it('shows the advisor line for six seconds after it speaks', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([], 'first'))
    expect(advisorLineShown(world)).toBeNull()
    applyTeamSceneInput(world, input([], 'Raised effort'))
    expect(actor(world, 'advisor')?.role).toBe('advisor')
    runUntil(world, () => false, 5.9)
    expect(advisorLineShown(world)).toBe('Raised effort')
    runUntil(world, () => false, 0.2)
    expect(advisorLineShown(world)).toBeNull()
  })
})
