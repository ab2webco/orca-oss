import type { OrchestratorGameSceneExtension } from '../../../src/shared/orchestrator-game-scene'
import type { GamePanelPace, GamePanelQuality } from '../../../src/shared/orchestrator-game-panel'
import type { DioramaMachine } from '../../../src/shared/team-scene/team-diorama-layout'
import type { Office3dFloorInput } from '../../../src/shared/team-scene/team-office3d-layout'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import type { TeamSceneArtPick } from './team-scene-band'

/** The 3D stage's camera: following the lead, the whole world, or where a finger left it. */
export type TeamSceneCameraMode = 'lead' | 'all' | 'free'

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
  /** Figures as the 3D diorama, when the host's panel asks for it; absent draws Figures in 2D. */
  diorama?: { quality: GamePanelQuality; pace: GamePanelPace }
  /** The Office as the 3D building, when the host draws it so; absent draws the 2D Office. */
  office3d?: { pace: GamePanelPace; words: { thisMachine: string; offline: string; lobby: string } }
}

export type TeamSceneEngineMessage =
  | { kind: 'stage'; stage: TeamSceneEngineStage }
  | {
      kind: 'input'
      input: TeamSceneInput
      leadLine: string | null
      advisorName: string
      /** The team's machines, for the diorama's islands; absent puts everyone on one island. */
      machines?: DioramaMachine[]
      /** The team's floors, a machine each, for the 3D Office. */
      floors?: Office3dFloorInput[]
    }
  /** `run` is false while nobody can see the band; `reduced` is the phone's Reduce Motion. */
  | { kind: 'motion'; run: boolean; reduced: boolean }
  /** A camera button, or a finger on the 3D stage: `pan` in points, `zoom` above 1 is closer. */
  | { kind: 'camera'; mode?: 'lead' | 'all'; pan?: [number, number]; zoom?: number }

export type TeamSceneEngineEvent =
  /** `camera` is present only while a 3D stage draws, whose camera the sheet then offers. */
  | { kind: 'ready'; height: number; camera?: TeamSceneCameraMode }
  | { kind: 'camera'; mode: TeamSceneCameraMode }
  | { kind: 'artFailed' }
  /** The stage stopped drawing; the sheet shows the names instead. */
  | { kind: 'error'; message: string }
