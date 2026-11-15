import type {
  OrchestratorGameArcade,
  OrchestratorGameArcadeEngine
} from '../../../../shared/orchestrator-game-arcade-file'
import { RUNNER_DRIVER } from './arcade-driver-runner'
import { SNAKE_DRIVER } from './arcade-driver-snake'

// One saved play in Orca's center tab: a built-in game's driver, its screens, and the pause while
// someone needs the user. The frame clock lives in the view; each game's rules live in src/shared.

export type ArcadeScreen = 'ready' | 'running' | 'held' | 'over'

/** The run's box in CSS pixels; pointer inputs are relative to its top-left corner. */
export type ArcadeView = { width: number; height: number }

export type ArcadeInput =
  | { kind: 'key'; code: string; isDown: boolean }
  | { kind: 'pointer'; x: number; y: number; isPress: boolean }

/** What a built-in game gives the tab: its rules over its own state, and how it draws. */
export type ArcadeDriver<G, S> = {
  startOf: (game: G, seed: number) => S
  stepOf: (game: G, state: S, dtMs: number) => S
  /** The state after an input while running; null when the input is not this game's. */
  inputOf: (game: G, state: S, input: ArcadeInput, view: ArcadeView) => S | null
  /** Keys that start a ready run; a tap always does. */
  isStartKey: (code: string) => boolean
  /** Whether the start press also plays: the snake's first arrow steers, the runner's does not jump. */
  playsStartPress: boolean
  scoreOf: (state: S) => number
  isOverOf: (state: S) => boolean
  msOf: (state: S) => number
  paint: (
    g: CanvasRenderingContext2D,
    game: G,
    state: S,
    view: ArcadeView & { isMoving: boolean }
  ) => void
}

/** A game and its state, closed over so the tab never needs to know which game it plays. */
export type ArcadePlay = {
  score: number
  isOver: boolean
  ms: number
  step: (dtMs: number) => ArcadePlay
  input: (input: ArcadeInput, view: ArcadeView) => ArcadePlay | null
  isStartKey: (code: string) => boolean
  playsStartPress: boolean
  paint: (g: CanvasRenderingContext2D, view: ArcadeView, isMoving: boolean) => void
}

export function arcadePlayOf<G, S>(driver: ArcadeDriver<G, S>, game: G, state: S): ArcadePlay {
  return {
    score: driver.scoreOf(state),
    isOver: driver.isOverOf(state),
    ms: driver.msOf(state),
    step: (dtMs) => arcadePlayOf(driver, game, driver.stepOf(game, state, dtMs)),
    input: (input, view) => {
      const next = driver.inputOf(game, state, input, view)
      return next === null ? null : arcadePlayOf(driver, game, next)
    },
    isStartKey: driver.isStartKey,
    playsStartPress: driver.playsStartPress,
    paint: (g, view, isMoving) => driver.paint(g, game, state, { ...view, isMoving })
  }
}

export type ArcadeRun = {
  engine: OrchestratorGameArcadeEngine
  play: ArcadePlay
  screen: ArcadeScreen
  /** The best score this tab has seen, the finished run included. */
  best: number
}

// Why 30: the epic caps every panel animation there; the rules step by real time either way.
export const ARCADE_FRAME_MS = 1000 / 30

function arcadePlayFor(game: OrchestratorGameArcade, seed: number): ArcadePlay {
  switch (game.engine) {
    case 'runner':
      return arcadePlayOf(RUNNER_DRIVER, game, RUNNER_DRIVER.startOf(game, seed))
    case 'snake':
      return arcadePlayOf(SNAKE_DRIVER, game, SNAKE_DRIVER.startOf(game, seed))
  }
}

export function arcadeRunOf(game: OrchestratorGameArcade, seed: number, best = 0): ArcadeRun {
  return { engine: game.engine, play: arcadePlayFor(game, seed), screen: 'ready', best }
}

// Why not arrows: a turn or jump pressed as the run ends must not close the tab under the player.
const CLOSE_KEYS = new Set(['Space', 'Enter'])

const isPress = (input: ArcadeInput): boolean =>
  input.kind === 'pointer' ? input.isPress : input.isDown

/**
 * What an input does to the run. `isGame` says the input was the game's (the view then keeps the
 * key from the page); `close` asks the tab to go back to the conversation after the run ended.
 */
export function inputArcadeRun(
  run: ArcadeRun,
  input: ArcadeInput,
  view: ArcadeView
): { run: ArcadeRun; close: boolean; isGame: boolean } {
  const same = { run, close: false, isGame: false }
  switch (run.screen) {
    case 'ready': {
      const isStart =
        input.kind === 'pointer' ? input.isPress : input.isDown && run.play.isStartKey(input.code)
      if (!isStart) {
        return same
      }
      const play = run.play.playsStartPress ? (run.play.input(input, view) ?? run.play) : run.play
      return { run: { ...run, play, screen: 'running' }, close: false, isGame: true }
    }
    case 'running': {
      const play = run.play.input(input, view)
      return play ? { run: { ...run, play }, close: false, isGame: true } : same
    }
    case 'held': {
      // Why releases only: a key let go during the pause must not stay held once the run goes on.
      const play = isPress(input) ? null : run.play.input(input, view)
      return play ? { run: { ...run, play }, close: false, isGame: true } : same
    }
    case 'over': {
      const close =
        input.kind === 'pointer' ? input.isPress : input.isDown && CLOSE_KEYS.has(input.code)
      return { run, close, isGame: close }
    }
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
      : { run: { ...run, screen: 'held' }, changed: true }
  }
  const play = run.play.step(run.screen === 'held' ? 0 : dtMs)
  return {
    run: {
      ...run,
      play,
      screen: play.isOver ? 'over' : 'running',
      best: play.isOver ? Math.max(run.best, play.score) : run.best
    },
    changed: true
  }
}
