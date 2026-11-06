import type { OrchestratorGameArcade } from '../../../../shared/orchestrator-game-arcade-file'
import {
  runnerOf,
  runnerStartOf,
  runnerStepOf,
  type Runner,
  type RunnerShape,
  type RunnerState
} from '../../../../shared/orchestrator-game-arcade-runner-rules'

// One saved play of the runner in Orca's center tab: the shared rules, a press, and the pause while
// someone needs the user. Drawing and the frame clock live in the view.

export type ArcadeScreen = 'ready' | 'running' | 'held' | 'over'

/** A sprite obstacle as the canvas draws it: its rows and their 24-bit colours. */
export type ArcadeSpriteShape = RunnerShape & {
  rows: readonly string[]
  colors: Record<string, number>
}

export type ArcadeRun = {
  runner: Runner<ArcadeSpriteShape>
  state: RunnerState
  screen: ArcadeScreen
  /** The best score this tab has seen, the finished run included. */
  best: number
  /** A press waiting for the next frame, so it takes off at the moment of the key. */
  isJump: boolean
}

// Why 30: the epic caps every panel animation there; the rules step by real time either way.
export const ARCADE_FRAME_MS = 1000 / 30

/** Sprite obstacles only: `from: scene` needs the terminal scene's decoration art. */
export function arcadeShapesOf(game: OrchestratorGameArcade): ArcadeSpriteShape[] {
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

export function arcadeRunOf(game: OrchestratorGameArcade, seed: number, best = 0): ArcadeRun {
  const runner = runnerOf(game, arcadeShapesOf(game))
  return { runner, state: runnerStartOf(runner, seed), screen: 'ready', best, isJump: false }
}

/** `close` asks the tab to go back to the conversation: a press after the run ended. */
export function pressArcadeRun(run: ArcadeRun): { run: ArcadeRun; close: boolean } {
  switch (run.screen) {
    case 'ready':
      return { run: { ...run, screen: 'running' }, close: false }
    case 'running':
      return { run: { ...run, isJump: true }, close: false }
    case 'held':
      return { run, close: false }
    case 'over':
      return { run, close: true }
  }
}

export function stepArcadeRun(
  run: ArcadeRun,
  dtMs: number,
  isHeld: boolean
): { run: ArcadeRun; changed: boolean } {
  if (run.screen === 'ready' || run.screen === 'over') {
    return { run, changed: false }
  }
  if (isHeld) {
    return run.screen === 'held'
      ? { run, changed: false }
      : { run: { ...run, screen: 'held', isJump: false }, changed: true }
  }
  const state = runnerStepOf(run.runner, run.state, run.screen === 'held' ? 0 : dtMs, run.isJump)
  const isOver = state.isOver
  return {
    run: {
      ...run,
      state,
      screen: isOver ? 'over' : 'running',
      best: isOver ? Math.max(run.best, state.score) : run.best,
      isJump: false
    },
    changed: true
  }
}
