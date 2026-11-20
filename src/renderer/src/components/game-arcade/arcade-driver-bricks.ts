import type { OrchestratorGameArcadeBricks } from '../../../../shared/orchestrator-game-arcade-file'
import {
  bricksAimOf,
  bricksMoveOf,
  bricksStartOf,
  bricksStepOf,
  type BricksMove,
  type BricksState
} from '../../../../shared/orchestrator-game-arcade-bricks-rules'
import { bricksBackdropOf, bricksColumnAtOf, paintBricksRun } from './arcade-bricks-paint'
import { arcadeIsTallOf } from './arcade-board'
import type { ArcadeDriver, ArcadeView } from './arcade-run-state'

/** The file's portrait field, wall and paddle in a tab taller than wide; the file as is otherwise. */
export function bricksFitOf(
  game: OrchestratorGameArcadeBricks,
  view: ArcadeView
): OrchestratorGameArcadeBricks {
  const tall = game.portrait
  return tall && arcadeIsTallOf(view)
    ? {
        ...game,
        field: tall.field,
        wall: { ...game.wall, ...tall.wall },
        paddle: { ...game.paddle, ...tall.paddle }
      }
    : game
}

const MOVE_KEYS: Readonly<Record<string, Exclude<BricksMove, 0>>> = {
  ArrowLeft: -1,
  KeyA: -1,
  ArrowRight: 1,
  KeyD: 1
}

export const BRICKS_DRIVER: ArcadeDriver<OrchestratorGameArcadeBricks, BricksState> = {
  startOf: bricksStartOf,
  fitOf: bricksFitOf,
  stepOf: bricksStepOf,
  inputOf: (game, state, input, view) => {
    if (input.kind === 'pointer') {
      return bricksAimOf(state, bricksColumnAtOf(game, view, input.x))
    }
    const move = MOVE_KEYS[input.code]
    if (move === undefined) {
      return null
    }
    // Why: letting go of one arrow while the other is held keeps the paddle on the held one.
    if (!input.isDown) {
      return state.move === move ? bricksMoveOf(state, 0) : state
    }
    return bricksMoveOf(state, move)
  },
  isStartKey: (code) => code in MOVE_KEYS || code === 'Space' || code === 'Enter',
  playsStartPress: true,
  scoreOf: (state) => state.score,
  isOverOf: (state) => state.isOver,
  msOf: (state) => state.ms,
  paint: (g, game, state, view) => paintBricksRun(g, game, state, view),
  backdropOf: bricksBackdropOf,
  isThemed: true
}
