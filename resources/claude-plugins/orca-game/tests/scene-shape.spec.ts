import { describe, expect, it } from 'vitest'

import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'
import {
  byScenePhase,
  sceneCard,
  sceneCostume,
  sceneFile,
  sceneLook
} from '../../../../src/shared/__fixtures__/orchestrator-game-scene'

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const quest = roundTrip(QUEST_SCENE) as Record<string, unknown>
const withCostume = (patch: Record<string, unknown>) => ({
  ...quest,
  costumes: {
    ...(quest.costumes as object),
    pr: { ...QUEST_SCENE.costumes.pr, ...patch }
  }
})

describe('sceneDefinitionOf', () => {
  it('accepts the built-in quest as Orca would serialize it, under the id it is given', () => {
    const scene = sceneDefinitionOf(quest, 'acme.space/orbit')
    expect(scene?.id).toBe('acme.space/orbit')
    expect(scene?.costumes.pr).toEqual(QUEST_SCENE.costumes.pr)
    expect(scene?.band).toEqual(QUEST_SCENE.band)
  })

  it('agrees with the schema Orca validates plugin scenes with', () => {
    const text = JSON.stringify(sceneFile())
    const orca = parseOrchestratorGameScene(text, 'acme.space/orbit')
    expect(orca.ok).toBe(true)
    expect(sceneDefinitionOf(JSON.parse(text), 'acme.space/orbit')).toEqual(
      orca.ok ? orca.definition : undefined
    )
    expect(parseOrchestratorGameScene(JSON.stringify(quest), 'quest').ok).toBe(true)
  })

  it('takes a name per language like Orca does, keeping only the languages it ships', () => {
    const text = JSON.stringify(
      sceneFile({
        cards: byScenePhase({
          ...sceneCard,
          name: { en: 'Pilot', es: 'Piloto', fr: 'Pilote' }
        }),
        teller: {
          icon: '❝',
          name: { en: 'Narrator', ja: '語り手' },
          color: '#8f9bb3'
        }
      })
    )
    const orca = parseOrchestratorGameScene(text, 'acme.space/orbit')
    const scene = sceneDefinitionOf(JSON.parse(text), 'acme.space/orbit')
    expect(scene?.cards.pr.name).toEqual({ en: 'Pilot', es: 'Piloto' })
    expect(scene?.teller.name).toEqual({ en: 'Narrator', ja: '語り手' })
    expect(scene).toEqual(orca.ok ? orca.definition : undefined)
  })

  it('takes the optional foe, finale and world like Orca does, and leaves them out when absent', () => {
    const text = JSON.stringify(
      sceneFile({
        looks: byScenePhase({
          ...sceneLook,
          plantKind: 'flower',
          scenery: 'meadow',
          isSignal: true
        }),
        foe: sceneCostume,
        finale: { en: '◓ CAUGHT!', es: '◓ ¡ATRAPADO!', fr: 'ATTRAPÉ' }
      })
    )
    const orca = parseOrchestratorGameScene(text, 'acme.space/orbit')
    const scene = sceneDefinitionOf(JSON.parse(text), 'acme.space/orbit')
    expect(scene?.foe).toEqual(sceneCostume)
    expect(scene?.finale).toEqual({ en: '◓ CAUGHT!', es: '◓ ¡ATRAPADO!' })
    expect(scene?.looks.pr).toMatchObject({
      plantKind: 'flower',
      scenery: 'meadow',
      isSignal: true
    })
    expect(scene).toEqual(orca.ok ? orca.definition : undefined)
    const plain = sceneDefinitionOf(quest, 'quest')
    expect(plain && ('foe' in plain || 'finale' in plain || 'scenery' in plain.looks.pr)).toBe(
      false
    )
  })

  it('takes #rrggbb colors like Orca does, as the integers the renderer draws', () => {
    const text = JSON.stringify(
      sceneFile({
        looks: byScenePhase({
          ...sceneLook,
          skyTop: '#4A7FC1',
          sun: '#ffe08a'
        }),
        foe: {
          ...sceneCostume,
          colors: { ...sceneCostume.colors, O: '#d77757' }
        }
      })
    )
    const orca = parseOrchestratorGameScene(text, 'acme.space/orbit')
    const scene = sceneDefinitionOf(JSON.parse(text), 'acme.space/orbit')
    expect(scene?.looks.pr.skyTop).toBe(0x4a7fc1)
    expect(scene?.looks.pr.sun).toBe(0xffe08a)
    expect(scene?.foe?.colors.O).toBe(0xd77757)
    expect(scene).toEqual(orca.ok ? orca.definition : undefined)
  })

  it('takes an optional hud palette like Orca does, as the integers the renderer draws', () => {
    const hud = {
      skyTop: '#5c94fc',
      skyBottom: '#a4c8fc',
      frame: '#fcd800',
      text: '#fcfcfc',
      dim: '#2038ec',
      star: 0xffffff
    }
    const text = JSON.stringify(sceneFile({ hud }))
    const orca = parseOrchestratorGameScene(text, 'acme.space/orbit')
    const scene = sceneDefinitionOf(JSON.parse(text), 'acme.space/orbit')
    expect(scene?.hud).toEqual({
      skyTop: 0x5c94fc,
      skyBottom: 0xa4c8fc,
      frame: 0xfcd800,
      text: 0xfcfcfc,
      dim: 0x2038ec,
      star: 0xffffff
    })
    expect(scene).toEqual(orca.ok ? orca.definition : undefined)
    expect(sceneDefinitionOf(quest, 'quest')).not.toHaveProperty('hud')
  })

  it.each([
    ['a short #rgb color', { looks: byScenePhase({ ...sceneLook, sun: '#fe8' }) }],
    ['a color name', { looks: byScenePhase({ ...sceneLook, sun: 'gold' }) }],
    [
      'a hex costume color with alpha',
      {
        foe: {
          ...sceneCostume,
          colors: { ...sceneCostume.colors, O: '#d77757ff' }
        }
      }
    ]
  ])('drops a scene with %s, as Orca does', (_label, patch) => {
    const text = JSON.stringify(sceneFile(patch))
    expect(parseOrchestratorGameScene(text, 'acme.space/orbit').ok).toBe(false)
    expect(sceneDefinitionOf(JSON.parse(text), 'acme.space/orbit')).toBeUndefined()
  })

  it.each([
    ['an unknown world', { looks: byScenePhase({ ...sceneLook, scenery: 'ocean' }) }],
    ['a signal that is not a boolean', { looks: byScenePhase({ ...sceneLook, isSignal: 'yes' }) }],
    ['an unknown plant', { looks: byScenePhase({ ...sceneLook, plantKind: 'fern' }) }],
    ['a foe glyph with no color', { foe: { ...sceneCostume, legs: ['.Q.O.O.O..', 'O.O.O.O.O.'] } }],
    ['a finale a Raster cannot draw', { finale: { en: 'WIN', ja: '勝利' } }],
    ['a finale too long for the scene', { finale: 'x'.repeat(25) }],
    ['a hud missing its frame', { hud: { skyTop: 1, skyBottom: 2, text: 3, dim: 4, star: 5 } }]
  ])('drops a scene with %s, as Orca does', (_label, patch) => {
    const text = JSON.stringify(sceneFile(patch))
    expect(parseOrchestratorGameScene(text, 'acme.space/orbit').ok).toBe(false)
    expect(sceneDefinitionOf(JSON.parse(text), 'acme.space/orbit')).toBeUndefined()
  })

  it.each([
    ['nothing', undefined],
    ['an array', [quest]],
    ['a missing phase', { ...quest, cards: { ...(quest.cards as object), handoff: undefined } }],
    [
      'a card color that is not hex',
      { ...quest, teller: { ...QUEST_SCENE.teller, color: 'gold' } }
    ],
    [
      'a look with a fractional color',
      {
        ...quest,
        looks: {
          ...(quest.looks as object),
          pr: { ...QUEST_SCENE.looks.pr, sun: 0.5 }
        }
      }
    ],
    [
      'a row that is not ten columns',
      withCostume({ rows: ['...', ...QUEST_SCENE.costumes.pr.rows.slice(1)] })
    ],
    ['a glyph with no color', withCostume({ legs: ['.Q.O.O.O..', 'O.O.O.O.O.'] })],
    [
      'a name with a terminal escape',
      {
        ...quest,
        teller: { ...QUEST_SCENE.teller, name: 'x\u001b]0;pwned\u0007' }
      }
    ],
    [
      'per-language names without English',
      { ...quest, teller: { ...QUEST_SCENE.teller, name: { es: 'Narrador' } } }
    ],
    [
      'a translated name with a terminal escape',
      {
        ...quest,
        teller: {
          ...QUEST_SCENE.teller,
          name: { en: 'N', ko: 'x\u001b]0;pwned\u0007' }
        }
      }
    ],
    [
      'a getter that throws',
      Object.defineProperty({ ...quest }, 'band', {
        get: () => {
          throw new Error('boom')
        },
        enumerable: true
      })
    ]
  ])('drops %s without throwing', (_label, value) => {
    expect(sceneDefinitionOf(value, 'acme.space/orbit')).toBeUndefined()
  })
})
