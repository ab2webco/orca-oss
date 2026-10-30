import { describe, expect, it } from 'vitest'
import { orchestratorGameSceneIssues, parseOrchestratorGameScene } from './orchestrator-game-scene'
import { ORCHESTRATOR_GAME_CHARACTER_ACCESSORIES } from './orchestrator-game-scene-characters'
import { byScenePhase, sceneCostume, sceneFile } from './__fixtures__/orchestrator-game-scene'

const text = (roster: unknown): string => JSON.stringify(sceneFile({ roster }))
const parse = (roster: unknown) => parseOrchestratorGameScene(text(roster), 'file:a.json')
const issuesOf = (roster: unknown): string[] => orchestratorGameSceneIssues(text(roster))

const princess = {
  rows: ['...YYYY...', '..YYYYYY..', '..PSSSSP..', '..SESSES..', '.PPPPPPPP.', '..PPPPPP..'],
  legs: ['..P....P..', '.P......P.'],
  colors: { Y: '#fcd800', P: '#f878f8', S: '#fca044', E: '#000000' }
}

describe('scene roster characters', () => {
  it('keeps a plain-name roster exactly as before, with no characters', () => {
    const parsed = parse(['Mario', { en: 'Peach', es: 'Melocotón' }])
    expect(parsed.ok && parsed.definition.roster).toEqual([
      'Mario',
      { en: 'Peach', es: 'Melocotón' }
    ])
    expect(parsed.ok && 'characters' in parsed.definition).toBe(false)
  })

  it('reads a variant entry: a palette over the phase sprites and an accessory', () => {
    const parsed = parse([
      'Mario',
      { name: 'Luigi', variant: { colors: { H: '#2e7d4f' }, accessory: 'crown' } },
      { name: 'Toad', variant: { accessory: 'halo', accessoryColor: 0xffffff } }
    ])
    expect(parsed.ok && parsed.warnings).toEqual([])
    expect(parsed.ok && parsed.definition.roster).toEqual(['Mario', 'Luigi', 'Toad'])
    expect(parsed.ok && parsed.definition.characters).toEqual([
      { name: 'Luigi', variant: { colors: { H: 0x2e7d4f }, accessory: 'crown' } },
      { name: 'Toad', variant: { accessory: 'halo', accessoryColor: 0xffffff } }
    ])
  })

  it('reads an entry with its own costume for every phase', () => {
    const parsed = parse([
      { name: { en: 'Peach', es: 'Melocotón' }, costumes: byScenePhase(princess) }
    ])
    expect(parsed.ok && parsed.definition.roster).toEqual([{ en: 'Peach', es: 'Melocotón' }])
    const characters = parsed.ok ? parsed.definition.characters : undefined
    expect(characters?.[0]?.costumes?.pr.colors.P).toBe(0xf878f8)
    expect(characters?.[0]?.costumes?.handoff.rows).toEqual(princess.rows)
  })

  it('offers a fixed list of accessories', () => {
    expect(ORCHESTRATOR_GAME_CHARACTER_ACCESSORIES).toEqual([
      'crown',
      'halo',
      'horns',
      'antenna',
      'bow',
      'feather',
      'cape'
    ])
  })

  it('reports every bad character, as validate shows it, and drops the roster', () => {
    const roster = [
      'Mario',
      { name: 'Luigi', variant: { accessory: 'hat' } },
      { name: 'Toad', variant: { colors: { Q: '#ffffff' } } },
      { name: 'Yoshi', variant: {} },
      { name: 'Daisy', variant: { accessoryColor: '#ffffff' } },
      { name: 'Wario', variant: { accessory: 'bow' }, costumes: byScenePhase(princess) },
      { name: 'Peach', costumes: { ...byScenePhase(princess), pr: { ...princess, rows: ['x'] } } },
      { name: 'Bowser', costumes: { working: princess } },
      { name: 'K-9', variant: { accessory: 'cape' } }
    ]
    const issues = [
      'roster.8.name: must not look like a ticket id',
      'roster.1.variant.accessory: must be one of crown, halo, horns, antenna, bow, feather, cape',
      'roster.2.variant.colors: glyph "Q" is in no costume',
      'roster.3.variant: must set colors or an accessory',
      'roster.4.variant.accessoryColor: needs an accessory',
      'roster.5: set a variant or costumes, not both',
      'roster.6.costumes.pr.rows.0: must be ten printable ASCII glyphs',
      'roster.6.costumes.pr.rows: Too small: expected array to have >=6 items',
      'roster.6.costumes.pr.colors: glyph "x" has no color',
      ...['docs', 'build', 'verify', 'pr', 'handoff'].map(
        (phase) => `roster.7.costumes.${phase}: Invalid input: expected object, received undefined`
      )
    ]
    expect(issuesOf(roster)).toEqual(issues)
    const parsed = parse(roster)
    expect(parsed.ok && parsed.definition.roster).toBeUndefined()
    expect(parsed.ok && parsed.definition.characters).toBeUndefined()
  })

  it('takes a palette glyph that any phase costume draws', () => {
    expect(sceneCostume.colors).toHaveProperty('B')
    expect(issuesOf([{ name: 'Luigi', variant: { colors: { B: '#000000' } } }])).toEqual([])
  })
})
