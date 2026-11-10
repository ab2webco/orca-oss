import { describe, expect, it } from 'vitest'
import {
  applyTeamSceneInput,
  createTeamSceneWorld,
  drainTeamSceneEffects,
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
import type { TeamSceneSite } from './team-scene-sites'

const WIDTH = 360
const DT = 1 / 30
const member = (
  key: string,
  activity: TeamSceneActivity = 'working',
  site: TeamSceneSite = { stage: 1, broken: false },
  mergedPr: number | null = null
): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity,
  reportId: null,
  mergedPr,
  site
})
const input = (members: TeamSceneMemberInput[]): TeamSceneInput => ({
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
  advisor: null,
  members
})
const actor = (world: TeamSceneWorld, key: string): TeamSceneActor =>
  teamSceneActors(world).find((a) => a.key === key)!
const home = (world: TeamSceneWorld, key: string): number => world.bodies.get(key)!.home.x

type Seen = { x: number; pose: string; carrying: boolean }
function watch(world: TeamSceneWorld, key: string, seconds: number) {
  const frames: Seen[] = []
  const effects: TeamSceneEffect[] = []
  for (let t = 0; t < seconds; t += DT) {
    stepTeamScene(world, DT, { width: WIDTH })
    effects.push(...drainTeamSceneEffects(world))
    const a = actor(world, key)
    frames.push({ x: a.x, pose: a.pose, carrying: a.carrying })
  }
  return { frames, effects }
}

function scene(members: TeamSceneMemberInput[]): TeamSceneWorld {
  const world = createTeamSceneWorld()
  applyTeamSceneInput(world, input(members))
  return world
}

describe('team scene work loop', () => {
  it('builds at its seat, then walks to its pile and carries material back, over and over', () => {
    const world = scene([member('a')])
    const x0 = home(world, 'a')
    const { frames, effects } = watch(world, 'a', 20)
    expect(frames.some((f) => f.x < x0 - 0.04)).toBe(true)
    expect(frames.some((f) => f.carrying && f.pose === 'walk')).toBe(true)
    const building = frames.filter((f) => f.pose === 'work')
    expect(building.length).toBeGreaterThan(0)
    expect(building.every((f) => Math.abs(f.x - x0) < 0.005)).toBe(true)
    const built = effects.filter((e) => e.kind === 'burst' && e.key === 'a' && e.reason === 'build')
    expect(built.length).toBeGreaterThanOrEqual(2)
  })

  it('never strikes in one place for long: it walks back to the pile', () => {
    const world = scene([member('a')])
    const { frames } = watch(world, 'a', 20)
    let longest = 0
    let run = 0
    for (const f of frames) {
      run = f.pose === 'work' ? run + 1 : 0
      longest = Math.max(longest, run)
    }
    expect(longest * DT).toBeLessThan(4)
  })

  it('repairs a broken site in place, without carrying', () => {
    const world = scene([member('a', 'working', { stage: 3, broken: true })])
    const x0 = home(world, 'a')
    watch(world, 'a', 6)
    const { frames, effects } = watch(world, 'a', 6)
    expect(
      frames.every((f) => f.pose === 'work' && !f.carrying && Math.abs(f.x - x0) < 0.005)
    ).toBe(true)
    expect(effects.some((e) => e.kind === 'burst' && e.reason === 'repair')).toBe(true)
  })

  it('a resting member wanders near its seat instead of standing still', () => {
    const world = scene([member('a', 'resting')])
    const x0 = home(world, 'a')
    const { frames } = watch(world, 'a', 15)
    expect(frames.some((f) => Math.abs(f.x - x0) > 0.02)).toBe(true)
    expect(frames.every((f) => Math.abs(f.x - x0) < 0.09)).toBe(true)
    expect(frames.some((f) => f.pose === 'work')).toBe(false)
  })

  it('a member who needs you stops working at its seat', () => {
    const world = scene([member('a')])
    watch(world, 'a', 3)
    applyTeamSceneInput(world, input([member('a', 'needsYou')]))
    watch(world, 'a', 6)
    expect(actor(world, 'a').x).toBe(home(world, 'a'))
    expect(actor(world, 'a').pose).toBe('raise')
  })

  it('shows each seat site at its real stage', () => {
    const world = scene([member('a', 'working', { stage: 2, broken: false })])
    expect(world.sites).toEqual([expect.objectContaining({ key: 'a', stage: 2, broken: false })])
    applyTeamSceneInput(world, input([member('a', 'working', { stage: 3, broken: true })]))
    expect(world.sites[0]).toEqual(expect.objectContaining({ stage: 3, broken: true }))
  })

  it('never takes a build down when the phase flickers between tools', () => {
    const world = scene([member('a', 'working', { stage: 1, broken: false })])
    applyTeamSceneInput(world, input([member('a', 'working', { stage: 0, broken: false })]))
    expect(world.sites[0]).toEqual(expect.objectContaining({ stage: 1 }))
    applyTeamSceneInput(world, input([member('a', 'working', { stage: 2, broken: true })]))
    applyTeamSceneInput(world, input([member('a', 'working', { stage: 1, broken: false })]))
    expect(world.sites[0]).toEqual(expect.objectContaining({ stage: 2, broken: false }))
  })

  it('keeps a merged site as a trophy after its member leaves', () => {
    const world = scene([member('a')])
    applyTeamSceneInput(world, input([member('a', 'done', { stage: 4, broken: false }, 12)]))
    expect(world.trophies.map((t) => t.key)).toEqual(['a'])
    applyTeamSceneInput(world, input([]))
    watch(world, 'lead', 30)
    expect(world.trophies.map((t) => t.key)).toEqual(['a'])
  })
})
