import { describe, expect, it } from 'vitest'

import questTemplate from '../../../../src/shared/orchestrator-game-scene-template.json'
import { HUD_ROWS, hudGridOf, type HudMember } from '../hooks/fleet-hud'
import { crownedLeadOf, LEAD_GOLD } from '../hooks/hd-party'
import { costumeSpriteOf } from '../hooks/hd-sprite'
import { UPPER_HALF } from '../hooks/pixel-canvas'
import { HD_ROWS, hdSceneGridOf } from '../hooks/scene-hd'
import { sceneOf, type SceneDefinition } from '../hooks/scenes/index'
import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'

const QUEST = sceneOf('quest')
const COLUMNS = 90
const HERO_COLUMNS = 14

// A project scene file whose hero has a one-pixel head, narrower than the crown.
const MARIO = sceneDefinitionOf(
  {
    ...questTemplate,
    costumes: {
      ...questTemplate.costumes,
      working: {
        rows: ['....R.....', '...RRR....', '..RRRRRR..', '.OEOOOEO..', 'OBBBBBBBO.', '.BBBBBBB..'],
        legs: ['.O.O.O.O..', 'O.O.O.O.O.'],
        colors: { O: '#d77757', E: '#1a1a1a', R: '#c0302a', B: '#2a4fc0' }
      }
    }
  },
  'mario'
)

const party: readonly HudMember[] = [
  { name: 'ORCA-1', phase: 'build', state: 'working', mood: 'none', says: 'implementing' }
]

/** Every pixel colour in the hero's corner of the HUD, frame excluded. */
const heroColorsOf = (grid: number[][]): number[] =>
  Array.from({ length: HUD_ROWS }, (_, row) =>
    grid.slice(row * COLUMNS + 1, row * COLUMNS + HERO_COLUMNS)
  )
    .flat()
    .flatMap((cell) => (cell[0] === UPPER_HALF ? [cell[1] ?? 0, cell[2] ?? 0] : []))

const isCrowned = (grid: number[][]): boolean => heroColorsOf(grid).includes(LEAD_GOLD)

const scenes = (): readonly [string, SceneDefinition][] => {
  if (MARIO === undefined) {
    throw new Error('the mario fixture no longer parses as a scene file')
  }
  return [
    ['quest', QUEST],
    ['vigilante', sceneOf('vigilante')],
    ['a project scene file', MARIO]
  ]
}

describe("the Panel's hero wears the band's crown", () => {
  for (const [label, scene] of scenes()) {
    it(`${label}: crowned on a lead's pane, at every tick and hero state`, () => {
      for (const tick of [0, 4, 9, 17]) {
        expect(isCrowned(hudGridOf(scene, party, COLUMNS, tick, { lead: 'Lead' })), `${tick}`).toBe(
          true
        )
        expect(
          isCrowned(hudGridOf(scene, [], COLUMNS, tick, { lead: 'Lead' })),
          `idle ${tick}`
        ).toBe(true)
        const waiting = [{ ...party[0], state: 'waiting' }] as const
        expect(
          isCrowned(hudGridOf(scene, waiting, COLUMNS, tick, { lead: 'Lead' })),
          `waiting ${tick}`
        ).toBe(true)
      }
    })

    it(`${label}: no crown on a member's pane or in the demo, as the band`, () => {
      expect(isCrowned(hudGridOf(scene, party, COLUMNS, 4))).toBe(false)
      const lead = crownedLeadOf('Lead', true)
      expect(lead).toBeUndefined()
      expect(isCrowned(hudGridOf(scene, party, COLUMNS, 4, { isDemo: true, lead }))).toBe(false)
    })

    it(`${label}: the same costume colours and crown as the band's hd hero`, () => {
      const costume = scene.costumes.working
      // Why not the crown's rows: the crown covers the head there, in the band too.
      const drawn = [...costume.rows.slice(3), costume.legs[0]].join('')
      const palette = Object.entries(costume.colors).filter(([glyph]) => drawn.includes(glyph))
      const hud = new Set(heroColorsOf(hudGridOf(scene, [], COLUMNS, 0, { lead: 'Lead' })))
      expect(palette.filter(([, color]) => !hud.has(color))).toEqual([])
      expect(costumeSpriteOf(costume, 0, false).colors).toEqual(costume.colors)
      const band = hdSceneGridOf({
        scene,
        phase: 'working',
        columns: 120,
        rows: HD_ROWS,
        tick: 0,
        caption: '',
        since: 0,
        lead: 'Lead'
      })
      const bandColors = new Set(
        band.flatMap((cell) => (cell[0] === UPPER_HALF ? [cell[1] ?? 0, cell[2] ?? 0] : []))
      )
      expect(bandColors.has(LEAD_GOLD) && hud.has(LEAD_GOLD)).toBe(true)
    })
  }

  it('with no scene file the Panel draws Quest crowned', () => {
    expect(sceneOf(undefined)).toBe(QUEST)
    expect(sceneOf('no-such-scene')).toBe(QUEST)
    expect(isCrowned(hudGridOf(sceneOf(undefined), party, COLUMNS, 4, { lead: 'Lead' }))).toBe(true)
  })

  it('keeps the crown inside the frame when the widest row is the costume top', () => {
    const wide = {
      ...QUEST.costumes.working,
      rows: ['.HHHHHHH..', ...QUEST.costumes.working.rows.slice(1)]
    }
    const scene = { ...QUEST, costumes: { ...QUEST.costumes, working: wide } }
    const grid = hudGridOf(scene, [], COLUMNS, 0, { lead: 'Lead' })
    expect(isCrowned(grid)).toBe(true)
    expect(grid.slice(0, COLUMNS).every((cell) => cell[1] !== LEAD_GOLD)).toBe(true)
  })
})
