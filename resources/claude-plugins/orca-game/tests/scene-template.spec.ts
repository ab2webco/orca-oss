import { describe, expect, it } from 'vitest'

import { QUEST_HUD } from '../hooks/fleet-hud'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../../../src/shared/orchestrator-game-scene-authoring'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'

// Why: Orca's CLI ships a copy of Quest it cannot import from here; this fails when they drift.
describe('the scene template `orca game scene new` writes', () => {
  it('is the built-in Quest with its hud palette, and the game draws it as Orca parses it', () => {
    const parsed = parseOrchestratorGameScene(ORCHESTRATOR_GAME_SCENE_TEMPLATE, 'quest')
    expect(parsed.ok ? parsed.definition : parsed.error).toEqual({ ...QUEST_SCENE, hud: QUEST_HUD })
    expect(sceneDefinitionOf(JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE), 'quest')).toEqual(
      parsed.ok ? parsed.definition : undefined
    )
  })
})
