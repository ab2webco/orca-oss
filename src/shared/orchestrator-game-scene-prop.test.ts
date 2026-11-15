import { describe, expect, it } from 'vitest'
import { orchestratorGameSceneIssues, parseOrchestratorGameScene } from './orchestrator-game-scene'
import { sceneFile as scene } from './__fixtures__/orchestrator-game-scene'

const HAMMER = { rows: ['HHH', 'HHH', '.W.', '.W.'], colors: { H: '#7a7a86', W: '#8a5a2c' } }

const parse = (value: unknown) =>
  parseOrchestratorGameScene(JSON.stringify(value), 'acme.pack/space')

describe('a scene file prop', () => {
  // ORCA-1202: a themed scene held Quest's sword because no file could say otherwise.
  it('leaves the prop out of a scene file that has none, so it draws nothing', () => {
    const parsed = parse(scene())
    expect(parsed.ok && 'prop' in parsed.definition).toBe(false)
    expect(orchestratorGameSceneIssues(JSON.stringify(scene()))).toEqual([])
  })

  it('reads a drawn prop with its colors as the numbers the panel paints', () => {
    const parsed = parse(scene({ prop: HAMMER }))
    expect(parsed.ok && parsed.definition.prop).toEqual({
      rows: HAMMER.rows,
      colors: { H: 0x7a7a86, W: 0x8a5a2c }
    })
    expect(parsed.ok && parsed.warnings).toEqual([])
  })

  it("takes Quest's sword by name", () => {
    const parsed = parse(scene({ prop: 'sword' }))
    expect(parsed.ok && parsed.definition.prop).toBe('sword')
  })

  it.each([
    ['another name', 'hammer', 'prop: must be "sword" or { rows, colors }'],
    ['an uneven frame', { ...HAMMER, rows: ['HHH', 'H'] }, 'prop.rows: every row of a frame'],
    ['an uncolored glyph', { ...HAMMER, rows: ['HXH'] }, 'prop.colors: glyph "X" has no color'],
    ['a frame taller than the hero', { ...HAMMER, rows: Array(8).fill('H') }, 'prop.rows:']
  ])('reports %s, and still draws the scene without the prop', (_, prop, issue) => {
    const text = JSON.stringify(scene({ prop }))
    expect(orchestratorGameSceneIssues(text)).toEqual([expect.stringContaining(issue)])
    const parsed = parseOrchestratorGameScene(text, 'acme.pack/space')
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && 'prop' in parsed.definition).toBe(false)
    expect(parsed.ok && parsed.warnings).toEqual([expect.stringContaining(issue)])
  })
})
