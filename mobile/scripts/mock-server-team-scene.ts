import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { GameCharacter } from '../../src/shared/orchestrator-game-characters'
import { GAME_HISTORY_OUTCOMES } from '../../src/shared/orchestrator-game-history'
import { DEFAULT_ORCHESTRATOR_GAME_CONFIG } from '../../src/shared/orchestrator-game-config'
import {
  GAME_PANEL_TABS,
  gamePanelPublishedOf,
  type OrchestratorGamePanel,
  type OrchestratorGamePublishedPanel
} from '../../src/shared/orchestrator-game-panel'
import { orchestratorGameScenesOf } from '../../src/shared/orchestrator-game-scene'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../src/shared/orchestrator-game-scene-authoring'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RpcRequest, RpcRespond, RpcResponse } from './mock-server-rpc-handlers'

const figure = (sheets: string[], size: number) => ({
  sheets,
  frame: { width: 32, height: 48 },
  size,
  animations: { idle: { row: 0, frames: 2, fps: 2 } }
})

// Why the host's own builder: it keys a plugin scene `pluginId/id` and drops one it cannot parse.
function customScenes() {
  const file = JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE) as Record<string, unknown>
  const native = {
    figures: {
      layers: [{ src: 'art/bg.png' }],
      roles: {
        lead: figure(['art/lead.png'], 56),
        member: figure(['art/member-a.png', 'art/member-b.png'], 48),
        advisor: figure(['art/advisor.png'], 48)
      }
    }
  }
  const text = JSON.stringify({ ...file, native })
  const { scenes, warnings } = orchestratorGameScenesOf([
    { pluginId: 'mock', id: 'neon-heist', text }
  ])
  if (scenes.length === 0) {
    throw new Error(`mock scene refused: ${warnings.join('; ')}`)
  }
  return scenes
}

// MOCK_PANEL_STYLE=pixel|office|figures (and MOCK_PANEL_LOOK) set the project's panel;
// MOCK_DIORAMA=1 draws Figures as the diorama, MOCK_QUALITY=low its low-resource look.
// MOCK_OLD_HOST=1 plays a host older than the 3D Office: office and high, but no office3d.
function panelOf(): OrchestratorGamePublishedPanel | undefined {
  const style = process.env.MOCK_PANEL_STYLE as OrchestratorGamePanel['style'] | undefined
  if (!style) {
    return undefined
  }
  const panel: OrchestratorGamePanel = {
    look: (process.env.MOCK_PANEL_LOOK as OrchestratorGamePanel['look'] | undefined) ?? 'game',
    style,
    tabs: Object.fromEntries(
      GAME_PANEL_TABS.map((tab) => [tab, true])
    ) as OrchestratorGamePanel['tabs'],
    advisor: true,
    arcade: false,
    diorama: process.env.MOCK_DIORAMA === '1',
    quality: process.env.MOCK_QUALITY === 'low' ? 'low' : 'high',
    pace: 'normal'
  }
  return process.env.MOCK_OLD_HOST === '1' ? panel : gamePanelPublishedOf(panel)
}

/** MOCK_CUSTOM_SCENE=1 selects a plugin scene with Figures art read from MOCK_SCENE_ART_DIR. */
export const teamSceneState = (): Partial<OrchestratorGameState> => ({
  ...(process.env.MOCK_CUSTOM_SCENE
    ? {
        config: { ...DEFAULT_ORCHESTRATOR_GAME_CONFIG, scene: customScenes()[0].id },
        extensions: { scenes: customScenes() }
      }
    : {}),
  ...(panelOf() ? { panel: panelOf() } : {})
})

const character = (name: string, xp: number, prsMerged: number): GameCharacter => ({
  key: name.toLowerCase(),
  name,
  tickets: prsMerged + 1,
  prsOpened: prsMerged + 1,
  prsMerged,
  outcomes: Object.fromEntries(
    GAME_HISTORY_OUTCOMES.map((one) => [one, 0])
  ) as GameCharacter['outcomes'],
  workedMs: prsMerged * 3_600_000,
  xp,
  lastAt: new Date(Date.now() - 3_600_000).toISOString(),
  recent: []
})

const CHARACTERS = [
  character('Alex', 1840, 12),
  character('Nova', 1210, 8),
  character('Juno', 655, 4)
]

/** game.characters for the level bar, and game.sceneArt for a custom scene's Figures art. */
export function handleMockTeamSceneRequest(
  request: RpcRequest,
  respond: RpcRespond,
  success: (id: string, result: unknown) => RpcResponse,
  error: (id: string, code: string, message: string) => RpcResponse
): boolean {
  if (request.method === 'game.characters') {
    respond(success(request.id, { characters: CHARACTERS }))
    return true
  }
  if (request.method !== 'game.sceneArt') {
    return false
  }
  const src = String(request.params?.src ?? '')
  const dir = process.env.MOCK_SCENE_ART_DIR
  // MOCK_CUSTOM_SCENE=fail: the host cannot read the art, so the phone falls back to Pixel.
  if (process.env.MOCK_CUSTOM_SCENE === 'fail' || !dir) {
    respond(error(request.id, 'not_found', `no art for ${src}`))
    return true
  }
  try {
    const contentBase64 = readFileSync(path.join(dir, path.basename(src))).toString('base64')
    respond(success(request.id, { contentBase64, mimeType: 'image/png' as const }))
  } catch {
    respond(error(request.id, 'not_found', `no art for ${src}`))
  }
  return true
}
