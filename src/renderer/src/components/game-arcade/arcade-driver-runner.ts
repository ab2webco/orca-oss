import type { OrchestratorGameArcadeRunner } from '../../../../shared/orchestrator-game-arcade-file'
import {
  runnerOf,
  runnerStartOf,
  runnerStepOf,
  type Runner,
  type RunnerShape,
  type RunnerState
} from '../../../../shared/orchestrator-game-arcade-runner-rules'
import { arcadeBackdropOf, paintRunnerRun } from './arcade-canvas-paint'
import type { ArcadeDriver } from './arcade-run-state'

/** A sprite obstacle as the canvas draws it: its rows and their 24-bit colours. */
export type ArcadeSpriteShape = RunnerShape & {
  rows: readonly string[]
  colors: Record<string, number>
}

export type RunnerPlayState = {
  runner: Runner<ArcadeSpriteShape>
  course: RunnerState
  /** A press waiting for the next frame, so it takes off at the moment of the key. */
  isJump: boolean
}

const JUMP_KEYS = new Set(['Space', 'ArrowUp'])

/** Sprite obstacles only: `from: scene` needs the terminal scene's decoration art. */
export function arcadeShapesOf(game: OrchestratorGameArcadeRunner): ArcadeSpriteShape[] {
  return game.obstacles.flatMap((one) => {
    if (!('rows' in one)) {
      return []
    }
    const width = one.rows[0]?.length ?? 0
    const heights = Array.from({ length: width }, (_, column) => {
      const top = one.rows.findIndex((row) => row[column] !== undefined && row[column] !== '.')
      return top === -1 ? 0 : one.rows.length - top
    })
    return [{ heights, weight: one.weight, rows: one.rows, colors: one.colors }]
  })
}

export const RUNNER_DRIVER: ArcadeDriver<OrchestratorGameArcadeRunner, RunnerPlayState> = {
  startOf: (game, seed) => {
    const runner = runnerOf(game, arcadeShapesOf(game))
    return { runner, course: runnerStartOf(runner, seed), isJump: false }
  },
  stepOf: (_game, state, dtMs) => ({
    ...state,
    course: runnerStepOf(state.runner, state.course, dtMs, state.isJump),
    isJump: false
  }),
  inputOf: (_game, state, input) =>
    (input.kind === 'key' && input.isDown && JUMP_KEYS.has(input.code)) ||
    (input.kind === 'pointer' && input.isPress)
      ? { ...state, isJump: true }
      : null,
  isStartKey: (code) => JUMP_KEYS.has(code),
  playsStartPress: false,
  scoreOf: (state) => Math.floor(state.course.score),
  isOverOf: (state) => state.course.isOver,
  msOf: (state) => state.course.ms,
  paint: (g, _game, state, view) => paintRunnerRun(g, state.runner, state.course, view),
  backdropOf: arcadeBackdropOf
}
