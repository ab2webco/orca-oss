import { describe, expect, it } from 'vitest'
import {
  orchestratorGameSceneIssues,
  orchestratorGameScenesOf,
  parseOrchestratorGameScene
} from './orchestrator-game-scene'
import {
  byScenePhase as byPhase,
  sceneCard as card,
  sceneCostume as costume,
  sceneFile as scene,
  sceneLook as look
} from './__fixtures__/orchestrator-game-scene'

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

  it('reads a pixel color written as #rrggbb and serves it as the number the mod draws', () => {
    const parsed = parse(
      scene({
        looks: byPhase({ ...look, sun: '#FFE08A' }),
        costumes: byPhase({ ...costume, colors: { ...costume.colors, H: '#3f6e46' } })
      })
    )
    expect(parsed.ok && parsed.definition.looks.pr.sun).toBe(0xffe08a)
    expect(parsed.ok && parsed.definition.costumes.pr.colors.H).toBe(0x3f6e46)
  })

  // Why: Orca Lab ships English and Spanish only (ORCA-596); other languages are dropped, not refused.
  it('takes a card or teller name per language, with English required', () => {
    const parsed = parse(
      scene({
        cards: byPhase({ ...card, name: { en: 'Pilot', es: 'Piloto', ja: 'パイロット' } }),
        teller: { icon: '❝', name: { en: 'Narrator', zh: '旁白' }, color: '#8f9bb3' }
      })
    )
    expect(parsed.ok && parsed.definition.cards.pr.name).toEqual({ en: 'Pilot', es: 'Piloto' })
    expect(parsed.ok && parsed.definition.teller.name).toEqual({ en: 'Narrator' })
    const plain = parse(scene())
    expect(plain.ok && plain.definition.teller.name).toBe('Narrator')
  })

  // Why: a scene that also names a language Orca does not ship yet still loads.
  it('drops a name in a language Orca does not ship', () => {
    const parsed = parse(
      scene({ cards: byPhase({ ...card, name: { en: 'Pilot', fr: 'Pilote' } }) })
    )
    expect(parsed.ok && parsed.definition.cards.pr.name).toEqual({ en: 'Pilot' })
  })

  it('takes an optional world, foe and merge finale, and leaves them out when absent', () => {
    const parsed = parse(
      scene({
        looks: byPhase({ ...look, plantKind: 'antenna', scenery: 'skyline', isSignal: true }),
        foe: { ...costume, colors: { ...costume.colors, H: '#8a2a3a' } },
        finale: { en: '◆ CASE CLOSED', es: '◆ CASO CERRADO' }
      })
    )
    expect(parsed.ok && parsed.definition.looks.pr).toMatchObject({
      plantKind: 'antenna',
      scenery: 'skyline',
      isSignal: true
    })
    expect(parsed.ok && parsed.definition.foe?.colors.H).toBe(0x8a2a3a)
    expect(parsed.ok && parsed.definition.finale).toEqual({
      en: '◆ CASE CLOSED',
      es: '◆ CASO CERRADO'
    })
    const plain = parse(scene())
    expect(plain.ok && ('foe' in plain.definition || 'finale' in plain.definition)).toBe(false)
    expect(plain.ok && 'scenery' in plain.definition.looks.pr).toBe(false)
  })

  it('takes an optional member roster, and leaves a bad one out with a warning', () => {
    const named = parse(scene({ roster: ['Mario', { en: 'Peach', es: 'Melocotón' }] }))
    expect(named.ok && named.definition.roster).toEqual(['Mario', { en: 'Peach', es: 'Melocotón' }])
    expect(named.ok && named.warnings).toEqual([])

    const bad = parse(scene({ roster: ['K-9'] }))
    expect(bad.ok).toBe(true)
    expect(bad.ok && bad.definition.roster).toBeUndefined()
    expect(bad.ok && bad.warnings).toEqual(['roster.0: must not look like a ticket id'])
  })

  it('takes optional palette themes, and leaves bad ones out with a clear warning', () => {
    const themed = parse(
      scene({ themes: [{ name: 'Dusk', weight: 0.5, look: { skyTop: '#ff0000', far: 255 } }] })
    )
    expect(themed.ok && themed.definition.themes).toEqual([
      { name: 'Dusk', weight: 0.5, look: { skyTop: 0xff0000, far: 255 } }
    ])
    expect(themed.ok && themed.warnings).toEqual([])
    const plain = parse(scene())
    expect(plain.ok && 'themes' in plain.definition).toBe(false)

    const bad = parse(scene({ themes: [{ name: 'Dusk', weight: 2, look: {} }] }))
    expect(bad.ok).toBe(true)
    expect(bad.ok && bad.definition.themes).toBeUndefined()
    expect(bad.ok && bad.warnings).toEqual([
      'themes.0.weight: must be from 0 to 1',
      'themes.0.look: must set at least one look color'
    ])
    expect(orchestratorGameSceneIssues(JSON.stringify(scene({ themes: 'dusk' })))).toEqual([
      'themes: must be a list of 1 to 8 themes'
    ])
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
      'per-language card names without English',
      JSON.stringify(scene({ cards: byPhase({ ...card, name: { es: 'Piloto' } }) })),
      'cards.working.name'
    ],
    [
      'a translated teller name with a terminal escape',
      JSON.stringify(
        scene({ teller: { icon: '❝', name: { en: 'N', es: 'x\u001b[2J' }, color: '#8f9bb3' } })
      ),
      'teller.name'
    ],
    [
      'an overlong translated card name',
      JSON.stringify(scene({ cards: byPhase({ ...card, name: { en: 'P', es: 'x'.repeat(33) } }) })),
      'cards.working.name'
    ],
    [
      'an unknown world',
      JSON.stringify(scene({ looks: byPhase({ ...look, scenery: 'ocean' }) })),
      'looks'
    ],
    [
      'a foe glyph with no color',
      JSON.stringify(scene({ foe: { ...costume, legs: ['.Z.O.O.O..', 'O.O.O.O.O.'] } })),
      'foe'
    ],
    [
      'a finale the pixel art cannot draw',
      JSON.stringify(scene({ finale: { en: 'WIN', es: '胜利' } })),
      'finale'
    ],
    ['an overlong finale', JSON.stringify(scene({ finale: 'x'.repeat(25) })), 'finale'],
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
