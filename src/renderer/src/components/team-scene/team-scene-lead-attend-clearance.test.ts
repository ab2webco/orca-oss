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
// Why these px: in the 1440 and 390 captures the lead's body is about 18 px wide and a face about 18.
const LEAD_HALF = 9
const FACE_HALF = 9
// TeamSceneCanvas's tag over an asker: its lifts and mark radius, and half a short name's width.
const MARK_LIFT = 25
const MARK_R = 9
const ASKER_LIFT = 38
const TAG_HALF = 22
// Why: a head touching the tag's foot by a hairline hides nothing.
const TAG_TOUCH = 2
// The Figures stage at a 1440 and a 390 window.
const WIDTHS = [349, 219]
const LAYOUTS = { office: painter.layout, ground: undefined }

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
  for (const [name, layout] of Object.entries(LAYOUTS)) {
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
            for (const other of actors.filter(
              (a) => a.role === 'member' && a.depth < leader.depth
            )) {
              const apart = Math.abs(leader.x - other.x) * width
              expect(apart, `the lead covers ${other.key}'s face`).toBeGreaterThanOrEqual(
                LEAD_HALF + FACE_HALF
              )
            }
            const asking = actors.find((a) => a.key === asker)!
            if (leader.depth < asking.depth) {
              // Why: behind, the lead's head must not sit under the asker's mark or name tag (TeamSceneCanvas).
              const frame = { width, height: painter.height, stations: world.stations }
              const mark = painter.emoteAt!(asking, frame)
              const tag = mark
                ? { x: mark.x, top: mark.y - MARK_LIFT, bottom: mark.y + MARK_R }
                : {
                    x: asking.x * width,
                    top: painter.headTop(asking.depth, painter.height) - ASKER_LIFT,
                    bottom: painter.headTop(asking.depth, painter.height)
                  }
              const head = painter.headTop(leader.depth, painter.height)
              const under =
                Math.abs(leader.x * width - tag.x) < TAG_HALF + LEAD_HALF &&
                head < tag.bottom - TAG_TOUCH &&
                head + FACE_HALF * 2 > tag.top
              expect(under, `the lead's head is under ${asker}'s tag`).toBe(false)
            }
            expect(leader.x * width - LEAD_HALF).toBeGreaterThanOrEqual(0)
            expect(leader.x * width + LEAD_HALF).toBeLessThanOrEqual(width)
          })
        }
      }
    }
  }
})
