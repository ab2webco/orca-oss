import { describe, expect, it } from 'vitest'
import {
  orchestratorGameSceneIssues,
  orchestratorGameScenesOf,
  parseOrchestratorGameScene
} from './orchestrator-game-scene'
import { sceneAdvisor, sceneFile, scenePet } from './__fixtures__/orchestrator-game-scene'

const text = (cast: unknown): string => JSON.stringify(sceneFile({ cast }))

describe('a scene cast', () => {
  it('serves the pet and the advisor with their colors as the numbers the mod draws', () => {
    const parsed = parseOrchestratorGameScene(
      text({ pet: scenePet, advisor: sceneAdvisor }),
      'file:mc.json'
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.warnings).toEqual([])
    expect(parsed.definition.cast?.pet).toEqual({
      ...scenePet,
      colors: { W: 0xd8d8d8, E: 0x1a1a1a, H: 0xff5a8a }
    })
    expect(parsed.definition.cast?.advisor?.gestures?.escalated).toEqual(
      sceneAdvisor.gestures.escalated
    )
    expect(parsed.definition.cast?.advisor?.colors).toEqual({ G: 0xb8b8b0, E: 0xd83a2e })
  })

  it('leaves the cast out of a scene that has none', () => {
    const parsed = parseOrchestratorGameScene(JSON.stringify(sceneFile()), 'file:mc.json')
    expect(parsed.ok && 'cast' in parsed.definition).toBe(false)
  })

  // Why: a typo in the pet must not take the whole scene, and its hero, away.
  it('drops only the cast member that is invalid, and warns with the path that has it', () => {
    const pet = { ...scenePet, happy: ['W...W', 'WWW'] }
    const parsed = parseOrchestratorGameScene(text({ pet, advisor: sceneAdvisor }), 'file:mc.json')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.definition.cast).toEqual({
      advisor: expect.objectContaining({ name: 'Golem' })
    })
    expect(parsed.warnings).toEqual(['cast.pet.happy: every row of a frame must be the same width'])
  })

  it.each([
    [
      'a frame taller than the hero',
      { pet: { ...scenePet, happy: Array(8).fill('W') } },
      'cast.pet.happy: Too big: expected array to have <=7 items'
    ],
    [
      'a row wider than ten',
      { advisor: { ...sceneAdvisor, frames: [['GGGGGGGGGGG']] } },
      'cast.advisor.frames.0.0: must be one to ten printable ASCII glyphs'
    ],
    [
      'frames of different sizes',
      { pet: { ...scenePet, frames: [scenePet.frames[0], ['W']] } },
      'cast.pet.frames: every frame must be the size of the first'
    ],
    [
      'a glyph with no color',
      {
        advisor: {
          ...sceneAdvisor,
          gestures: { raised: ['.GGG.', 'GEGEG', 'GGXGG', 'G.G.G', '.G.G.'] }
        }
      },
      'cast.advisor.colors: glyph "X" has no color'
    ],
    ['a cast that is not an object', 7, 'cast: Invalid input: expected object, received number']
  ])('warns about %s', (_label, cast, warning) => {
    const parsed = parseOrchestratorGameScene(text(cast), 'file:mc.json')
    expect(parsed.ok && parsed.warnings).toEqual([warning])
  })

  // Why: a scene written for a newer Orca, with a gesture this one does not act out, still loads.
  it('ignores a gesture the game does not act out', () => {
    const advisor = { ...sceneAdvisor, gestures: { ...sceneAdvisor.gestures, dance: ['.GGG.'] } }
    const parsed = parseOrchestratorGameScene(text({ advisor }), 'file:mc.json')
    expect(parsed.ok && parsed.warnings).toEqual([])
    expect(parsed.ok && parsed.definition.cast?.advisor?.gestures).toEqual(sceneAdvisor.gestures)
  })

  it('lists cast problems among the issues `orca game scene validate` reports', () => {
    expect(orchestratorGameSceneIssues(text({ pet: { ...scenePet, frames: [] } }))).toEqual([
      'cast.pet.frames: Too small: expected array to have >=1 items'
    ])
  })

  it("names a plugin scene's dropped cast member in Orca's warnings and keeps the scene", () => {
    const { scenes, warnings } = orchestratorGameScenesOf([
      { pluginId: 'acme.mc', id: 'overworld', text: text({ pet: { frames: 1 } }) }
    ])
    expect(scenes.map((one) => one.id)).toEqual(['acme.mc/overworld'])
    expect(warnings[0]).toMatch(
      /^game scene acme\.mc\/overworld: cast\.pet\.frames: .+; drawn without it$/
    )
  })
})
