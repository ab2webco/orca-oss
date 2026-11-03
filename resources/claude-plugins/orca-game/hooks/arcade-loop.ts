import { runnerStartOf, runnerStepOf, type Runner, type RunnerState } from './arcade-runner'
import { RUNNER_LEVEL_MS } from './arcade-runner-course'
import { ARCADE_FPS_MAX } from './arcade-runner-data'
import { arcadeWords } from './arcade-words'

// The runner's clock: one timer only while a run moves, none before the first press, while paused
// or after the run ends, so an open game that nobody plays costs nothing.

export type ArcadeClock = {
  now: () => Promise<number>
  /** As `$.clock.every`: a timer `cancel()` stops. */
  every: (ms: number, fn: () => void) => { cancel: () => void }
}

export type ArcadeScreen = 'ready' | 'running' | 'paused' | 'held' | 'over'

// How often a held run checks whether the user answered.
export const ARCADE_HOLD_POLL_MS = 1000
const LEVEL_SHOWN_MS = 1500

/** The run a caption speaks of: its level, how long it has run, and the best before it. */
export type ArcadeRun = { level: number; ms: number; best: number }

/** The line over the sky: what the one key does now, or a new level for a moment while running. */
export const arcadeCaptionOf = (
  screen: ArcadeScreen,
  score: number,
  run?: ArcadeRun
): string | undefined => {
  const words = arcadeWords()
  switch (screen) {
    case 'ready':
      return words.ready
    case 'paused':
      return words.paused
    case 'held':
      return words.held
    case 'over':
      return run !== undefined && score > run.best ? words.best(score) : words.over(score)
    case 'running':
      return run !== undefined &&
        run.level > 1 &&
        run.ms - (run.level - 1) * RUNNER_LEVEL_MS < LEVEL_SHOWN_MS
        ? words.level(run.level)
        : undefined
  }
}

export type ArcadeLoop = {
  /** The one game key: starts, resumes, jumps, or starts over after a run ends. */
  press: () => void
  stop: () => void
}

export const arcadeLoopOf = (args: {
  runner: Runner
  seed: number
  /** The best score of earlier games this session. */
  best?: number
  clock: ArcadeClock
  /** Whether the game's pane is shown and holds the keyboard. */
  isActive: () => Promise<boolean>
  /** Whether an agent waits on the user: the run freezes and goes on by itself once answered. */
  isHeld: () => boolean
  /** `best` is the highest score of the runs before this one. */
  draw: (state: RunnerState, screen: ArcadeScreen, best: number) => void
}): ArcadeLoop => {
  const { runner, clock } = args
  // Why clamp here too: a game file read past its validator must still not outrun a terminal Raster.
  const periodMs = 1000 / Math.min(runner.game.fps, ARCADE_FPS_MAX)
  let state = runnerStartOf(runner, args.seed)
  let runs = 0
  let best = args.best ?? 0
  let timer: { cancel: () => void } | undefined
  let watch: { cancel: () => void } | undefined
  let last: number | undefined
  let isJump = false
  let isTicking = false

  const halt = () => {
    timer?.cancel()
    timer = undefined
    watch?.cancel()
    watch = undefined
    last = undefined
  }
  const run = () => {
    timer = clock.every(periodMs, () => void tick())
  }
  const tick = async () => {
    if (isTicking) {
      return
    }
    isTicking = true
    try {
      if (!(await args.isActive())) {
        halt()
        args.draw(state, 'paused', best)
        return
      }
      if (args.isHeld()) {
        halt()
        isJump = false
        args.draw(state, 'held', best)
        watch = clock.every(ARCADE_HOLD_POLL_MS, () => {
          if (!args.isHeld()) {
            watch?.cancel()
            watch = undefined
            run()
          }
        })
        return
      }
      const now = await clock.now()
      state = runnerStepOf(runner, state, last === undefined ? periodMs : now - last, isJump)
      last = now
      isJump = false
      if (state.isOver) {
        halt()
      }
      args.draw(state, state.isOver ? 'over' : 'running', best)
    } finally {
      isTicking = false
    }
  }
  args.draw(state, 'ready', best)
  return {
    press: () => {
      if (watch !== undefined) {
        return
      }
      if (timer !== undefined) {
        isJump = true
        // Why now: waiting for the next frame takes off up to a frame late.
        void tick()
        return
      }
      if (state.isOver) {
        best = Math.max(best, state.score)
        runs += 1
        state = runnerStartOf(runner, args.seed + runs)
      }
      run()
    },
    stop: halt
  }
}
