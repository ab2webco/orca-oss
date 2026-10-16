// Why a copy of Quest: the CLI compiles without the game mod; a test fails the moment they differ.
import questTemplate from './orchestrator-game-scene-template.json'

export { orchestratorGameSceneIssues } from './orchestrator-game-scene'

/** A complete scene to start from: the built-in Quest, with its hud palette spelled out. */
export const ORCHESTRATOR_GAME_SCENE_TEMPLATE = `${JSON.stringify(questTemplate, null, 2)}\n`
