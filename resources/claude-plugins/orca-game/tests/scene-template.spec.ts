import { describe, expect, it } from 'vitest'

import { QUEST_HUD } from '../hooks/fleet-hud'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../../../src/shared/orchestrator-game-scene-authoring'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'

// Why: Orca's CLI ships a copy of Quest it cannot import from here; this fails when they drift.
describe('the scene template `orca game scene new` writes', () => {
  it('is the built-in Quest with its hud palette plus example extras, drawn as Orca parses it', () => {
    const parsed = parseOrchestratorGameScene(ORCHESTRATOR_GAME_SCENE_TEMPLATE, 'quest')
    const definition = parsed.ok ? parsed.definition : undefined
    // Why: Quest has no foe, finale or pet; the template adds one of each to show their shape.
    const { foe, finale, cast, ...quest } = definition ?? QUEST_SCENE
    expect([foe, finale, cast?.pet].every((extra) => extra !== undefined)).toBe(true)
    expect({ ...quest, cast: { advisor: cast?.advisor } }).toEqual({
      ...QUEST_SCENE,
      hud: QUEST_HUD
    })
    expect(sceneDefinitionOf(JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE), 'quest')).toEqual(
      parsed.ok ? parsed.definition : undefined
    )
  })
})
