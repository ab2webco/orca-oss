import { runnerStartOf, runnerStepOf, type Runner, type RunnerState } from './arcade-runner'
import { ARCADE_FPS_MAX } from './arcade-runner-data'
import { arcadeWords } from './arcade-words'

// The runner's clock: one timer only while a run moves, none before the first press, while paused
// or after the run ends, so an open game that nobody plays costs nothing.

export type ArcadeClock = {
  now: () => Promise<number>
  /** As `$.clock.every`: a timer `cancel()` stops. */
  every: (ms: number, fn: () => void) => { cancel: () => void }
}

export type ArcadeScreen = 'ready' | 'running' | 'paused' | 'over'

/** The line over the sky on each screen but a run in play: what the one key does now. */
export const arcadeCaptionOf = (screen: ArcadeScreen, score: number): string | undefined => {
  const words = arcadeWords()
  switch (screen) {
    case 'ready':
      return words.ready
    case 'paused':
      return words.paused
    case 'over':
      return words.over(score)
    case 'running':
      return undefined
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
  clock: ArcadeClock
  /** Whether the game's pane is shown and holds the keyboard. */
  isActive: () => Promise<boolean>
  draw: (state: RunnerState, screen: ArcadeScreen) => void
}): ArcadeLoop => {
  const { runner, clock } = args
  // Why clamp here too: a game file read past its validator must still not outrun a terminal Raster.
  const periodMs = 1000 / Math.min(runner.game.fps, ARCADE_FPS_MAX)
  let state = runnerStartOf(runner, args.seed)
  let runs = 0
  let timer: { cancel: () => void } | undefined
  let last: number | undefined
  let isJump = false
  let isTicking = false

  const halt = () => {
    timer?.cancel()
    timer = undefined
    last = undefined
  }
  const tick = async () => {
    if (isTicking) {
      return
    }
    isTicking = true
    try {
      if (!(await args.isActive())) {
        halt()
        args.draw(state, 'paused')
        return
      }
      const now = await clock.now()
      state = runnerStepOf(runner, state, last === undefined ? periodMs : now - last, isJump)
      last = now
      isJump = false
      if (state.isOver) {
        halt()
      }
      args.draw(state, state.isOver ? 'over' : 'running')
    } finally {
      isTicking = false
    }
  }
  args.draw(state, 'ready')
  return {
    press: () => {
      if (timer !== undefined) {
        isJump = true
        return
      }
      if (state.isOver) {
        runs += 1
        state = runnerStartOf(runner, args.seed + runs)
      }
      timer = clock.every(periodMs, () => void tick())
    },
    stop: halt
  }
}
