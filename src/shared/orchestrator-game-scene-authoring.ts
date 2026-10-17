// Why a copy of Quest: the CLI compiles without the game mod; a test fails the moment they differ.
// The foe, finale and pet are the template's own, examples of the optional blocks Quest lacks.
import questTemplate from './orchestrator-game-scene-template.json'

export { orchestratorGameSceneIssues } from './orchestrator-game-scene'

/** A complete scene to start from: the built-in Quest, its hud palette, and an example foe, finale and pet. */
export const ORCHESTRATOR_GAME_SCENE_TEMPLATE = `${JSON.stringify(questTemplate, null, 2)}\n`
