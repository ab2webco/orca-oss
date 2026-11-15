import type { OrchestratorGameSceneExtension } from '../../../src/shared/orchestrator-game-scene'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import type { TeamSceneArtPick } from './team-scene-band'

// Why apart from the engine: the sheet sends these, and must not pull the desktop painters into
// the app's program (the engine is typechecked with the desktop's compiler, tsconfig.scene-engine.json).

/** The painters' four meanings, as team-scene-painter-marks.ts names them. */
export type TeamSceneEngineColors = {
  attention: string
  done: string
  working: string
  risk: string
}

export type TeamSceneEngineStage = {
  art: TeamSceneArtPick
  /** Every image the art names, by its path in the style; empty for Pixel. */
  images: Record<string, string>
  scenes: OrchestratorGameSceneExtension[]
  timezone: string
  nowMs: number
  colors: TeamSceneEngineColors
}

export type TeamSceneEngineMessage =
  | { kind: 'stage'; stage: TeamSceneEngineStage }
  | { kind: 'input'; input: TeamSceneInput; leadLine: string | null }

export type TeamSceneEngineEvent = { kind: 'ready'; height: number } | { kind: 'artFailed' }
