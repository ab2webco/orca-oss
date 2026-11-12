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

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3', risk: '#ffaa04' }
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
  colors: COLORS,
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
// The mark's 7 px disc plus a gap, and the visitor's head as drawn from its head top.
const MARK_R = 9
const HEAD = { half: 9, tall: 18 }

describe('a visiting lead and the needs-you mark', () => {
  it.each([195, 320, 420])(
    'leaves the mark clear at %i px, at the edge or between desks',
    (width) => {
      for (const keys of [
        ['herrero', 'rivas'],
        ['rivas', 'herrero', 'luna']
      ]) {
        const world = createTeamSceneWorld()
        const members = keys.map((k) => member(k, k === 'herrero' ? 'needsYou' : 'working'))
        const lead = { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' } as const
        const floor = { lead, advisor: null, members, leadless: true as const }
        applyTeamSceneInput(world, floor, painter.layout)
        applyTeamSceneInput(world, { ...floor, ride: { guest: 'herrero' } }, painter.layout)
        for (let t = 0; t < 20; t += 1 / 30) {
          stepTeamScene(world, 1 / 30, { width })
        }
        const actors = teamSceneActors(world)
        const visitor = actors.find((a) => a.role === 'lead')!
        const asker = actors.find((a) => a.key === 'herrero')!
        const frame = { width, height: painter.height, stations: world.stations }
        const mark = painter.emoteAt!(asker, frame)!
        const head = {
          left: visitor.x * width - HEAD.half,
          right: visitor.x * width + HEAD.half,
          top: painter.headTop(visitor.depth, painter.height),
          bottom: painter.headTop(visitor.depth, painter.height) + HEAD.tall
        }
        const nearX = Math.max(head.left, Math.min(mark.x, head.right))
        const nearY = Math.max(head.top, Math.min(mark.y, head.bottom))
        expect(
          Math.hypot(mark.x - nearX, mark.y - nearY),
          `${width} px, ${keys.join()}`
        ).toBeGreaterThan(MARK_R)
      }
    }
  )
})
