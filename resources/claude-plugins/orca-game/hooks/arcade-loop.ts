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

export type ArcadeScreen = 'ready' | 'running' | 'paused' | 'held' | 'over'

// How often a held run checks whether the user answered.
export const ARCADE_HOLD_POLL_MS = 1000

/** The line over the sky on each screen but a run in play: what the one key does now. */
export const arcadeCaptionOf = (
  screen: ArcadeScreen,
  score: number,
  best = 0
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
      return words.over(score, best > 0 && score >= best)
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
  /** Whether an agent waits on the user: the run freezes and goes on by itself once answered. */
  isHeld: () => boolean
  /** The best score before this loop, kept by its caller across loops. */
  best?: number
  draw: (state: RunnerState, screen: ArcadeScreen, best: number) => void
}): ArcadeLoop => {
  const { runner, clock } = args
  // Why clamp here too: a game file read past its validator must still not outrun a terminal Raster.
  const periodMs = 1000 / Math.min(runner.game.fps, ARCADE_FPS_MAX)
  let state = runnerStartOf(runner, args.seed)
  let runs = 0
  let timer: { cancel: () => void } | undefined
  let watch: { cancel: () => void } | undefined
  let last: number | undefined
  let best = args.best ?? 0
  // Why times and not a flag: the jump starts when the key came, and two keys are a double jump.
  let presses: Promise<number>[] = []
  let isTicking = false

  const halt = () => {
    presses = []
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
      const pending = presses
      presses = []
      const times = await Promise.all(pending)
      const now = await clock.now()
      let from = last ?? now - periodMs
      let isPressed = false
      for (const time of times) {
        const to = Math.min(now, Math.max(from, time))
        state = runnerStepOf(runner, state, to - from, isPressed)
        from = to
        isPressed = true
      }
      state = runnerStepOf(runner, state, now - from, isPressed)
      last = now
      if (state.isOver) {
        halt()
        best = Math.max(best, state.score)
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
        presses.push(clock.now())
        return
      }
      if (state.isOver) {
        runs += 1
        state = runnerStartOf(runner, args.seed + runs)
      }
      run()
    },
    stop: halt
  }
}
