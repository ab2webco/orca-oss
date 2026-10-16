import { describe, expect, it } from 'vitest'

import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'
import { sceneFile } from '../../../../src/shared/__fixtures__/orchestrator-game-scene'

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const quest = roundTrip(QUEST_SCENE) as Record<string, unknown>
const withCostume = (patch: Record<string, unknown>) => ({
  ...quest,
  costumes: { ...(quest.costumes as object), pr: { ...QUEST_SCENE.costumes.pr, ...patch } }
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
      { ...quest, looks: { ...(quest.looks as object), pr: { ...QUEST_SCENE.looks.pr, sun: 0.5 } } }
    ],
    [
      'a row that is not ten columns',
      withCostume({ rows: ['...', ...QUEST_SCENE.costumes.pr.rows.slice(1)] })
    ],
    ['a glyph with no color', withCostume({ legs: ['.Q.O.O.O..', 'O.O.O.O.O.'] })],
    [
      'a name with a terminal escape',
      { ...quest, teller: { ...QUEST_SCENE.teller, name: 'x\u001b]0;pwned\u0007' } }
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
