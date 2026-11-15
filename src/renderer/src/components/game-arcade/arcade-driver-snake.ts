import type { OrchestratorGameArcadeSnake } from '../../../../shared/orchestrator-game-arcade-file'
import {
  snakeStartOf,
  snakeStepOf,
  snakeTurnOf,
  type SnakeDirection,
  type SnakeState
} from '../../../../shared/orchestrator-game-arcade-snake-rules'
import type { ArcadeDriver } from './arcade-run-state'
import { paintSnakeRun, snakeBackdropOf, snakeTapTurnOf } from './arcade-snake-paint'

// Why codes, not keys: WASD stays where it is on any keyboard layout.
export const ARCADE_TURN_KEYS: Readonly<Record<string, SnakeDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right'
}

export const SNAKE_DRIVER: ArcadeDriver<OrchestratorGameArcadeSnake, SnakeState> = {
  startOf: snakeStartOf,
  stepOf: snakeStepOf,
  inputOf: (game, state, input, view) => {
    const turn =
      input.kind === 'key'
        ? input.isDown
          ? ARCADE_TURN_KEYS[input.code]
          : undefined
        : input.isPress
          ? snakeTapTurnOf(game, state, view, input.x, input.y)
          : undefined
    return turn ? snakeTurnOf(state, turn) : null
  },
  isStartKey: (code) => code in ARCADE_TURN_KEYS || code === 'Space' || code === 'Enter',
  playsStartPress: true,
  scoreOf: (state) => state.score,
  isOverOf: (state) => state.isOver,
  msOf: (state) => state.ms,
  paint: (g, game, state, view) => paintSnakeRun(g, game, state, view),
  backdropOf: snakeBackdropOf
}
