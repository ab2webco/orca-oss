import { describe, expect, it } from 'vitest'

import { characterCostumeOf } from '../hooks/character-look'
import { tileBackdropOf } from '../hooks/fleet-tiles'
import { lightnessOf } from '../hooks/hd-lightness'
import { FIGURE_FLOOR } from '../hooks/hd-readability'
import { localizedNameOf } from '../hooks/game-strings'
import { SCENES, type ScenePhase } from '../hooks/scenes/index'
import { ORCHESTRATOR_GAME_BUILT_IN_ROSTERS } from '../../../../src/shared/orchestrator-game-member-names'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../../../src/shared/orchestrator-game-scene-authoring'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'

const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']
const english = (name: Parameters<typeof localizedNameOf>[0]): string => localizedNameOf(name, 'en')

describe.each(Object.values(SCENES))('built-in scene $id', (scene) => {
  const roster =
    ORCHESTRATOR_GAME_BUILT_IN_ROSTERS[scene.id as keyof typeof ORCHESTRATOR_GAME_BUILT_IN_ROSTERS]

  it('dresses only names of its roster, ten or more of them', () => {
    expect(roster.length).toBeGreaterThanOrEqual(10)
    // Why: Orca reserves member names from its own copy of the roster.
    expect(scene.roster).toEqual(roster)
    const names = roster.map(english)
    expect((scene.characters ?? []).map((one) => english(one.name))).toEqual(
      names.filter((name) => (scene.characters ?? []).some((one) => english(one.name) === name))
    )
    expect(scene.characters?.length).toBeGreaterThanOrEqual(roster.length - 1)
  })

  it.each(PHASES)('draws every character differently in %s', (phase) => {
    const looks = roster.map((name) =>
      JSON.stringify(characterCostumeOf(scene, english(name), phase))
    )
    expect(new Set(looks).size).toBe(roster.length)
  })

  it('draws every accessory apart from the dark wall it stands on', () => {
    const wall = lightnessOf(tileBackdropOf(0))
    const sunk = (scene.characters ?? []).filter(
      ({ variant }) =>
        variant?.accessoryColor !== undefined &&
        Math.abs(lightnessOf(variant.accessoryColor) - wall) < FIGURE_FLOOR
    )
    expect(sunk.map((one) => english(one.name))).toEqual([])
  })

  it('recolors only glyphs its costumes draw', () => {
    const drawn = new Set(PHASES.flatMap((phase) => Object.keys(scene.costumes[phase].colors)))
    const stray = (scene.characters ?? []).flatMap((one) =>
      Object.keys(one.variant?.colors ?? {}).filter((glyph) => !drawn.has(glyph))
    )
    expect(stray).toEqual([])
  })
})

describe('the template `orca game scene new` writes', () => {
  it('starts with ten characters, each in a look of its own', () => {
    const parsed = parseOrchestratorGameScene(ORCHESTRATOR_GAME_SCENE_TEMPLATE, 'file:new.json')
    expect(parsed.ok && parsed.warnings).toEqual([])
    const definition = parsed.ok ? parsed.definition : undefined
    expect(definition?.roster).toHaveLength(10)
    const scene = { ...SCENES.quest!, characters: definition?.characters }
    for (const phase of PHASES) {
      const looks = (definition?.roster ?? []).map((name) =>
        JSON.stringify(characterCostumeOf(scene, english(name), phase))
      )
      expect(new Set(looks).size).toBe(10)
    }
  })
})
