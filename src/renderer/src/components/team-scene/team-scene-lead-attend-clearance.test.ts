import { describe, expect, it } from 'vitest'
import { orchestratorGameSceneArtFiles } from '../../../../shared/orchestrator-game-scene-native'
import { teamSceneActors } from '../../../../shared/team-scene/team-scene-actors'
import {
  applyTeamSceneInput,
  createTeamSceneWorld,
  stepTeamScene
} from '../../../../shared/team-scene/team-scene-director'
import type { TeamSceneMemberInput } from '../../../../shared/team-scene/team-scene-types'
import { createImagePainter, type TeamSceneArtImage } from './team-scene-image-painter'
import { OFFICE_BACK_SEAT } from './team-scene-office-back'
import { teamSceneQuestArtOf } from './team-scene-quest-art'

const art = teamSceneQuestArtOf('office')
const painter = createImagePainter({
  art: {
    style: art,
    images: new Map(
      orchestratorGameSceneArtFiles({ figures: art }).map((src): [string, TeamSceneArtImage] => [
        src,
        { width: 256, height: 256 } as unknown as TeamSceneArtImage
      ])
    )
  },
  colors: { attention: '#ff0001', done: '#00ff02', working: '#0000f3', risk: '#ffaa04' },
  builds: 'office',
  back: OFFICE_BACK_SEAT
})
const member = (key: string, activity: 'working' | 'needsYou'): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity,
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false }
})
// Why these reaches: in the captures a ground lead's raised sword crosses a face 20 px away, not 26;
// an Office lead holds nothing, and its asker shows the back of its head.
const LAYOUTS = [
  { name: 'office', layout: painter.layout, reach: 14 },
  { name: 'ground', layout: undefined, reach: 26 }
]
const LEAD_HALF = 9
// Why: main's spot beside the asker; the lead never stands closer than it did.
const BESIDE_X = 0.075
const LEAD_HOME_X = 0.84
// The Figures stage at a 1440 and a 390 window.
const WIDTHS = [349, 219]

/** The members, with the attended asker at seat `seat`: it is on the floor first, so the lead picks it. */
function floorWith(count: number, seat: 'first' | 'middle' | 'last') {
  const shown = Math.min(count, 8)
  const at = seat === 'first' ? 0 : seat === 'middle' ? Math.floor((shown - 1) / 2) : shown - 1
  // Why every seat before it asks too: askers sit first, so only then does it sit at seat `at`.
  const members = Array.from({ length: count }, (_, i) =>
    member(`m${i}`, i <= at ? 'needsYou' : 'working')
  )
  return { asker: `m${at}`, members }
}

// Why (ORCA-1190): the lead attending a member who needs you never stands over its face, nor a neighbour's.
describe('a lead attending a member who needs you', () => {
  for (const { name, layout, reach } of LAYOUTS) {
    for (const width of WIDTHS) {
      for (const count of [1, 4, 9]) {
        for (const seat of ['first', 'middle', 'last'] as const) {
          it(`stands clear of every face it is drawn over: ${name}, ${width} px, ${count} members, ${seat} seat`, () => {
            const { asker, members } = floorWith(count, seat)
            const lead = {
              key: 'lead',
              name: 'Lead',
              characterKey: null,
              activity: 'working'
            } as const
            const world = createTeamSceneWorld()
            // Why the asker alone first: the lead goes to the asker that came to the floor first.
            applyTeamSceneInput(
              world,
              { lead, advisor: null, members: [member(asker, 'working')] },
              layout
            )
            applyTeamSceneInput(world, { lead, advisor: null, members }, layout)
            // Why seated too: a member still walking to its desk passes the lead, as it may.
            const settled = () =>
              world.rounds.stage === 'atMember' &&
              teamSceneActors(world).every((a) => a.role !== 'member' || a.pose !== 'walk')
            for (let t = 0; t < 60 && !settled(); t += 1 / 30) {
              stepTeamScene(world, 1 / 30, { width })
            }
            expect(world.rounds.member, 'the lead attends the asker').toBe(asker)
            expect(world.rounds.stage).toBe('atMember')
            const actors = teamSceneActors(world)
            const leader = actors.find((a) => a.role === 'lead')!
            const asking = actors.find((a) => a.key === asker)!
            expect(leader.depth, 'the lead stands in front of the asker').toBeGreaterThan(
              asking.depth
            )
            expect(leader.facing, 'the lead faces the asker').toBe(leader.x > asking.x ? -1 : 1)
            const fromAsker = Math.abs(leader.x - asking.x) * width
            // Why main's spot: beside the asker toward the lead's home, halfway to the next seat at most.
            const toward = asking.x < LEAD_HOME_X ? 1 : -1
            const next = world.stations
              .map((s) => (s.x - asking.x) * width * toward)
              .filter((d) => d > 0.1)
            const main = Math.min(BESIDE_X * width, ...next.map((d) => d / 2))
            expect(fromAsker, 'closer than main put it').toBeGreaterThanOrEqual(main - 2)
            for (const other of actors.filter(
              (a) => a.role === 'member' && a.depth < leader.depth
            )) {
              const apart = Math.abs(leader.x - other.x) * width
              expect(apart, `the lead covers ${other.key}'s face`).toBeGreaterThanOrEqual(
                reach - 0.5
              )
            }
            expect(leader.x * width - LEAD_HALF).toBeGreaterThanOrEqual(0)
            expect(leader.x * width + LEAD_HALF).toBeLessThanOrEqual(width)
          })
        }
      }
    }
  }
})

// Why: the panel narrows while the lead attends (1440 to 390); its spot must follow the new width.
describe('a lead already attending when the stage narrows', () => {
  it('moves to clear the asker at the new width', () => {
    const lead = { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' } as const
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, { lead, advisor: null, members: [member('m0', 'needsYou')] })
    for (let t = 0; t < 40 && world.rounds.stage !== 'atMember'; t += 1 / 30) {
      stepTeamScene(world, 1 / 30, { width: 349 })
    }
    expect(world.rounds.stage).toBe('atMember')
    for (let t = 0; t < 10; t += 1 / 30) {
      stepTeamScene(world, 1 / 30, { width: 219 })
    }
    const actors = teamSceneActors(world)
    const leader = actors.find((a) => a.role === 'lead')!
    const asking = actors.find((a) => a.key === 'm0')!
    expect(Math.abs(leader.x - asking.x) * 219).toBeGreaterThanOrEqual(26 - 0.5)
  })
})
