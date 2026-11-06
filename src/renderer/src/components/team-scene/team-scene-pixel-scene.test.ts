import { describe, expect, it } from 'vitest'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import { JRPG_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/jrpg'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import { teamScenePixelSceneOf } from './team-scene-pixel-scene'

const NOON_UTC = Date.UTC(2026, 10, 6, 12)

describe('teamScenePixelSceneOf', () => {
  it('draws a built-in scene by its id', () => {
    const scene = teamScenePixelSceneOf({
      sceneId: JRPG_SCENE.id,
      nowMs: NOON_UTC,
      timezone: 'UTC'
    })
    expect(scene.id).toBe(JRPG_SCENE.id)
  })

  it('draws a plugin or file scene from the definitions game state carries', () => {
    const definition = { ...QUEST_SCENE, id: 'acme.pack/night' }
    const extension = {
      id: 'acme.pack/night',
      pluginId: 'acme.pack',
      definition
    } as unknown as OrchestratorGameSceneExtension
    const scene = teamScenePixelSceneOf({
      sceneId: 'acme.pack/night',
      extensions: { scenes: [extension] },
      nowMs: NOON_UTC,
      timezone: 'UTC'
    })
    expect(scene.id).toBe('acme.pack/night')
  })

  it('falls back to Quest for a scene an older host did not send', () => {
    const scene = teamScenePixelSceneOf({
      sceneId: 'acme.pack/gone',
      nowMs: NOON_UTC,
      timezone: 'UTC'
    })
    expect(scene.id).toBe(QUEST_SCENE.id)
  })
})
