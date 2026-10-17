import { describe, expect, it } from 'vitest'

import { STATE_RING, type HdMember } from '../hooks/hd-party'
import { costumeSpriteOf, ringOf } from '../hooks/hd-sprite'
import { UPPER_HALF } from '../hooks/pixel-canvas'
import type { AdvisorPose } from '../hooks/scene-cast'
import { HD_ROWS, hdSceneGridOf } from '../hooks/scene-hd'
import type { SceneAdvisor, SceneDefinition } from '../hooks/scenes/index'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../../../src/shared/orchestrator-game-scene-authoring'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'

const parsed = parseOrchestratorGameScene(ORCHESTRATOR_GAME_SCENE_TEMPLATE, 'file:template.json')
if (!parsed.ok) {
  throw new Error(parsed.error)
}
const WITH_PET: SceneDefinition = parsed.definition
const PET_FUR = 0xd8782a

// The widest advisor a scene may draw: ten glyphs.
const WIDE: SceneAdvisor = {
  name: 'Wide',
  frames: [['AAAAAAAAAA', 'AEAAAAAAEA', 'AAAAAAAAAA', '.AAAAAAAA.', '.A......A.']],
  colors: { A: 0x7a7a90, E: 0x101010 }
}
const poseOf = (sprite: SceneAdvisor): AdvisorPose => ({ sprite, age: 0, bubble: '' })
const ADVISORS = [undefined, poseOf(WITH_PET.cast?.advisor ?? WIDE), poseOf(WIDE)]

const PARTY: HdMember[] = [
  { key: 'a', phase: 'verify', state: 'working' },
  { key: 'b', phase: 'docs', state: 'waiting' }
]

const columnsWith = (grid: number[][], columns: number, color: number): number[] =>
  grid.flatMap((cell, i) =>
    cell[0] === UPPER_HALF && (cell[1] === color || cell[2] === color) ? [i % columns] : []
  )

// Either leg frame: a waiting member hops, a working one walks.
const ringsOf = (member: HdMember): number[] =>
  [0, 1].map((frame) =>
    ringOf(costumeSpriteOf(WITH_PET.costumes[member.phase], frame, false), STATE_RING[member.state])
  )

describe('the hd party in frame', () => {
  it('keeps the hero’s pet and both teammates in frame on every step, at 60 and 130 columns', () => {
    for (const columns of [60, 130]) {
      for (const advisor of ADVISORS) {
        for (let tick = 0; tick < 480; tick += 1) {
          const grid = hdSceneGridOf({
            scene: WITH_PET,
            phase: 'build',
            columns,
            rows: HD_ROWS,
            tick,
            caption: '',
            since: 0,
            party: PARTY,
            advisor
          })
          const missing = PARTY.filter((member) =>
            ringsOf(member).every((ring) => columnsWith(grid, columns, ring).length === 0)
          ).map((member) => member.key)
          const pet = columnsWith(grid, columns, PET_FUR)
          expect({
            columns,
            advisor: advisor?.sprite.name,
            tick,
            missing,
            pet: pet.length > 0
          }).toEqual({ columns, advisor: advisor?.sprite.name, tick, missing: [], pet: true })
        }
      }
    }
  })

  it('keeps the whole party short of the advisor', () => {
    for (let tick = 0; tick < 480; tick += 3) {
      const advisor = poseOf(WIDE)
      const grid = hdSceneGridOf({
        scene: WITH_PET,
        phase: 'build',
        columns: 60,
        rows: HD_ROWS,
        tick,
        caption: '',
        since: 0,
        party: PARTY,
        advisor,
        action: 'edit'
      })
      const wide = Math.min(...columnsWith(grid, 60, 0x7a7a90))
      const party = [PET_FUR, ...PARTY.flatMap(ringsOf)].flatMap((color) =>
        columnsWith(grid, 60, color)
      )
      expect(Math.max(...party)).toBeLessThan(wide - 1)
    }
  })

  it('shows three teammates at 130 columns with a pet and an advisor', () => {
    const party: HdMember[] = [...PARTY, { key: 'c', phase: 'pr', state: 'idle' }]
    const idle = [
      ringOf(costumeSpriteOf(WITH_PET.costumes.pr, 0, true), STATE_RING.idle),
      ...ringsOf(party[2] as HdMember)
    ]
    for (let tick = 0; tick < 480; tick += 5) {
      const grid = hdSceneGridOf({
        scene: WITH_PET,
        phase: 'build',
        columns: 130,
        rows: HD_ROWS,
        tick,
        caption: '',
        since: 0,
        party,
        advisor: poseOf(WIDE)
      })
      const shown = [...PARTY.map(ringsOf), idle].filter((rings) =>
        rings.some((ring) => columnsWith(grid, 130, ring).length > 0)
      )
      expect([tick, shown.length]).toEqual([tick, 3])
    }
  })
})
