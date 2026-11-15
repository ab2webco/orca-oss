import { describe, expect, it } from 'vitest'
import { teamSceneActors } from './team-scene-actors'
import {
  applyTeamSceneInput,
  createTeamSceneWorld,
  drainTeamSceneEffects,
  stepTeamScene,
  type TeamSceneWorld
} from './team-scene-director'
import type { TeamSceneEffect, TeamSceneInput, TeamSceneMemberInput } from './team-scene-types'

const DT = 1 / 30
const OFFICE = { rowSize: 5, workSeated: true, firstX: 0.16, rowGrows: true }
const member = (key: string, decisions?: TeamSceneMemberInput['decisions']) =>
  ({
    key,
    name: key,
    characterKey: null,
    activity: 'working',
    reportId: null,
    mergedPr: null,
    site: { stage: 0, broken: false },
    ...(decisions ? { decisions } : {})
  }) as const
// Why a resting lead: it stays at its spot, so only the advisor moves.
const input = (members: TeamSceneMemberInput[]): TeamSceneInput => ({
  lead: { key: 'lead', name: 'Alfred', characterKey: null, activity: 'resting' },
  advisor: { line: 'Jev' },
  members
})

function run(world: TeamSceneWorld, seconds: number, width: number, each?: () => void) {
  const effects: TeamSceneEffect[] = []
  for (let t = 0; t < seconds; t += DT) {
    stepTeamScene(world, DT, { width })
    effects.push(...drainTeamSceneEffects(world))
    each?.()
  }
  return effects
}

// ORCA-1218: Jev stood still, over the lead at the panel's right edge.
describe('the advisor at home', () => {
  for (const width of [220, 390, 640]) {
    it(`keeps a body clear of the lead and never stands still, at ${width} px`, () => {
      const world = createTeamSceneWorld()
      applyTeamSceneInput(world, input([member('a'), member('b')]), OFFICE)
      const advisor = world.bodies.get('advisor')!
      const lead = world.bodies.get('lead')!
      const xs = new Set<number>()
      const facings = new Set<number>()
      run(world, 12, width, () => {
        xs.add(Math.round(advisor.x * width))
        facings.add(advisor.facing)
        expect((lead.x - advisor.x) * width).toBeGreaterThanOrEqual(30)
      })
      expect(xs.size, 'the advisor never moved').toBeGreaterThan(2)
      expect(facings.size, 'the advisor never looked another way').toBe(2)
    })
  }
})

describe('a Jev decision', () => {
  it('sends a token to the judged member in the step it arrives, the advisor raising a hand', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([member('a'), member('b')]), OFFICE)
    run(world, 1, 640)
    applyTeamSceneInput(
      world,
      input([member('a'), member('b', [{ id: 'd1', verdict: 'deny', gesture: null }])]),
      OFFICE
    )
    expect(drainTeamSceneEffects(world)).toContainEqual({ kind: 'verdict', to: 'b', tone: 'deny' })
    stepTeamScene(world, DT, { width: 640 })
    expect(teamSceneActors(world).find((a) => a.key === 'advisor')?.pose).toBe('raise')
  })

  it('sends none without an advisor on the floor', () => {
    const world = createTeamSceneWorld()
    const plain = (members: TeamSceneMemberInput[]) => ({ ...input(members), advisor: null })
    applyTeamSceneInput(world, plain([member('a')]), OFFICE)
    applyTeamSceneInput(
      world,
      plain([member('a', [{ id: 'd1', verdict: 'allow', gesture: null }])]),
      OFFICE
    )
    expect(drainTeamSceneEffects(world).filter((e) => e.kind === 'verdict')).toEqual([])
  })
})
