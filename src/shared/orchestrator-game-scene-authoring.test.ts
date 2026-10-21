import { describe, expect, it } from 'vitest'
import { parseOrchestratorGameScene } from './orchestrator-game-scene'
import {
  ORCHESTRATOR_GAME_SCENE_TEMPLATE,
  orchestratorGameSceneIssues
} from './orchestrator-game-scene-authoring'

describe('orchestratorGameSceneIssues', () => {
  it('finds nothing in a valid scene', () => {
    expect(orchestratorGameSceneIssues(ORCHESTRATOR_GAME_SCENE_TEMPLATE)).toEqual([])
  })

  it('carries an example of every optional block, all of them drawn', () => {
    const parsed = parseOrchestratorGameScene(ORCHESTRATOR_GAME_SCENE_TEMPLATE, 'template')
    expect(parsed.ok && parsed.warnings).toEqual([])
    const definition = parsed.ok ? parsed.definition : undefined
    expect(definition?.foe).toBeDefined()
    expect(definition?.finale).toBeDefined()
    expect(definition?.hud).toBeDefined()
    expect(definition?.cast?.pet).toBeDefined()
    expect(definition?.cast?.advisor).toBeDefined()
    expect(definition?.roster?.length).toBeGreaterThan(0)
    expect(definition?.themes?.length).toBeGreaterThan(0)
  })

  it('lists every problem with the path that has it, not only the first', () => {
    const scene = JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE)
    scene.looks.pr.sun = 'gold'
    scene.costumes.build.rows[2] = 'too-short'
    delete scene.band.ink
    expect(orchestratorGameSceneIssues(JSON.stringify(scene))).toEqual([
      'looks.pr.sun: must be a #rrggbb color or an integer from 0 to 16777215',
      'costumes.build.rows.2: must be ten printable ASCII glyphs',
      'costumes.build.colors: glyph "t" has no color',
      'band.ink: Invalid input: expected string, received undefined'
    ])
  })

  it('says when the text is not JSON at all', () => {
    expect(orchestratorGameSceneIssues('{ looks: ')).toEqual(['not valid JSON'])
  })
})
