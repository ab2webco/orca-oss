import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_GAME_SCENE_PHASES,
  orchestratorGameScenesOf,
  parseOrchestratorGameScene
} from './orchestrator-game-scene'

const look = {
  skyTop: 0x4a7fc1,
  skyBottom: 0xa9d4f5,
  sun: 0xffe08a,
  isNight: false,
  far: 0x6d7f99,
  snow: 0xf2f5fa,
  near: 0x4f8a55,
  ground: 0x6b4f35,
  plant: 0x2f6b3a,
  plantKind: 'cactus',
  cloud: 0xf4f7fb
}
const costume = {
  rows: ['..........', '..HHHHH...', '.HHHHHHH..', '.OEOOOEO..', 'OBBBBBBBO.', '.BBBBBBB..'],
  legs: ['.O.O.O.O..', 'O.O.O.O.O.'],
  colors: { O: 0xd77757, E: 0x1a1a1a, H: 0x3f6e46, B: 0x5f7f3a }
}
const card = { icon: '✦', name: 'Pilot', color: '#7fa86a' }
const byPhase = <T>(value: T): Record<string, T> =>
  Object.fromEntries(ORCHESTRATOR_GAME_SCENE_PHASES.map((phase) => [phase, value]))

function scene(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    looks: byPhase(look),
    costumes: byPhase(costume),
    cards: byPhase(card),
    teller: { icon: '❝', name: 'Narrator', color: '#8f9bb3' },
    band: { gold: '#c9a24a', ink: '#1a1f33', panel: '#2b3150', parchment: '#f1e2b8' },
    ...overrides
  }
}

const parse = (value: unknown) =>
  parseOrchestratorGameScene(JSON.stringify(value), 'acme.pack/space')

describe('parseOrchestratorGameScene', () => {
  it('accepts a complete scene and stamps the namespaced id on it', () => {
    const parsed = parse(scene())
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.definition.id).toBe('acme.pack/space')
      expect(parsed.definition.costumes.pr.rows).toHaveLength(6)
      expect(parsed.definition.looks.handoff.plantKind).toBe('cactus')
    }
  })

  it('ignores an id inside the file so a plugin cannot claim another namespace', () => {
    const parsed = parse(scene({ id: 'quest' }))
    expect(parsed.ok && parsed.definition.id).toBe('acme.pack/space')
  })

  it.each([
    ['text that is not JSON', '{nope', 'not valid JSON'],
    [
      'a missing phase',
      JSON.stringify(scene({ cards: { ...byPhase(card), pr: undefined } })),
      'cards.pr'
    ],
    [
      'a color out of range',
      JSON.stringify(scene({ looks: byPhase({ ...look, sun: 0x1000000 }) })),
      'looks'
    ],
    [
      'a fractional color',
      JSON.stringify(scene({ looks: byPhase({ ...look, sun: 1.5 }) })),
      'looks'
    ],
    [
      'a costume row that is not ten columns',
      JSON.stringify(
        scene({ costumes: byPhase({ ...costume, rows: ['.....', ...costume.rows.slice(1)] }) })
      ),
      'costumes'
    ],
    [
      'a costume with a seventh row',
      JSON.stringify(
        scene({ costumes: byPhase({ ...costume, rows: [...costume.rows, '..........'] }) })
      ),
      'costumes'
    ],
    [
      'a glyph with no color',
      JSON.stringify(
        scene({ costumes: byPhase({ ...costume, legs: ['.Z.O.O.O..', 'O.O.O.O.O.'] }) })
      ),
      'glyph "Z"'
    ],
    [
      'a card color that is not hex',
      JSON.stringify(scene({ cards: byPhase({ ...card, color: 'red' }) })),
      'cards'
    ],
    [
      'a card name with a terminal escape',
      JSON.stringify(scene({ cards: byPhase({ ...card, name: 'Pilot\u001b[2J' }) })),
      'cards'
    ],
    [
      'an overlong card name',
      JSON.stringify(scene({ cards: byPhase({ ...card, name: 'x'.repeat(33) }) })),
      'cards'
    ],
    [
      'a band color that is not hex',
      JSON.stringify(
        scene({ band: { gold: '#c9a24a', ink: 1, panel: '#2b3150', parchment: '#f1e2b8' } })
      ),
      'band.ink'
    ]
  ])('rejects %s without throwing', (_label, text, error) => {
    const parsed = parseOrchestratorGameScene(text, 'acme.pack/space')
    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.error).toContain(error)
  })
})

describe('orchestratorGameScenesOf', () => {
  it('namespaces scenes by plugin and turns every bad source into a warning', () => {
    const { scenes, warnings } = orchestratorGameScenesOf([
      { pluginId: 'acme.pack', id: 'space', text: JSON.stringify(scene()) },
      { pluginId: 'other.pack', id: 'space', text: JSON.stringify(scene()) },
      { pluginId: 'acme.pack', id: 'broken', text: '{' },
      { pluginId: 'acme.pack', id: 'missing', error: 'ENOENT: no such file' }
    ])

    expect(scenes.map((one) => [one.id, one.pluginId, one.definition.id])).toEqual([
      ['acme.pack/space', 'acme.pack', 'acme.pack/space'],
      ['other.pack/space', 'other.pack', 'other.pack/space']
    ])
    expect(warnings).toEqual([
      expect.stringContaining('game scene acme.pack/broken dropped: not valid JSON'),
      'game scene acme.pack/missing dropped: ENOENT: no such file'
    ])
  })

  it('keeps the first of two sources that resolve to the same id', () => {
    const text = JSON.stringify(scene())
    const { scenes, warnings } = orchestratorGameScenesOf([
      { pluginId: 'acme.pack', id: 'space', text },
      { pluginId: 'acme.pack', id: 'space', text }
    ])
    expect(scenes).toHaveLength(1)
    expect(warnings).toEqual(['game scene acme.pack/space dropped: duplicate scene id'])
  })
})
