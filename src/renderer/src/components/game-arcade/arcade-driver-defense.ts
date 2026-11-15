import type { OrchestratorGameArcadeDefense } from '../../../../shared/orchestrator-game-arcade-file'
import {
  defenseAimOf,
  defenseFireOf,
  defenseMoveOf,
  defenseStartOf,
  defenseStepOf,
  type DefenseMove,
  type DefenseState
} from '../../../../shared/orchestrator-game-arcade-defense-rules'
import { defenseBackdropOf, defenseColumnAtOf, paintDefenseRun } from './arcade-defense-paint'
import type { ArcadeDriver } from './arcade-run-state'

const MOVE_KEYS: Readonly<Record<string, Exclude<DefenseMove, 0>>> = {
  ArrowLeft: -1,
  KeyA: -1,
  ArrowRight: 1,
  KeyD: 1
}

export const DEFENSE_DRIVER: ArcadeDriver<OrchestratorGameArcadeDefense, DefenseState> = {
  startOf: defenseStartOf,
  stepOf: defenseStepOf,
  inputOf: (game, state, input, view) => {
    if (input.kind === 'pointer') {
      const aimed = defenseAimOf(state, defenseColumnAtOf(game, view, input.x))
      return input.isPress ? defenseFireOf(aimed) : aimed
    }
    if (input.code === 'Space') {
      // Why down only: a held Space fires again on the keyboard's own repeat.
      return input.isDown ? defenseFireOf(state) : state
    }
    const move = MOVE_KEYS[input.code]
    if (move === undefined) {
      return null
    }
    // Why: letting go of one arrow while the other is held keeps the turret on the held one.
    if (!input.isDown) {
      return state.move === move ? defenseMoveOf(state, 0) : state
    }
    return defenseMoveOf(state, move)
  },
  isStartKey: (code) => code in MOVE_KEYS || code === 'Space' || code === 'Enter',
  playsStartPress: true,
  scoreOf: (state) => state.score,
  isOverOf: (state) => state.isOver,
  msOf: (state) => state.ms,
  paint: (g, game, state, view) => paintDefenseRun(g, game, state, view),
  backdropOf: defenseBackdropOf
}
