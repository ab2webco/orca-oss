export type TeamSceneFrameScheduler = {
  request: (cb: (now: number) => void) => number
  cancel: (id: number) => void
}

const FPS = 30
// Why the slack: a 60 Hz frame lands a hair under 33.3 ms, which would halve the rate to 20 fps.
const INTERVAL_MS = 1000 / FPS - 2
// Why: a long main-thread stall must not teleport walkers across the stage.
const MAX_DT_SECONDS = 0.05

export type TeamSceneFrameLoop = {
  setRunning: (running: boolean) => void
  dispose: () => void
}

/**
 * Paints at most 30 times a second, only while running. `dt` is capped for motion and `elapsed`
 * is the real time since the last paint; both restart at 0 after a pause.
 */
export function createTeamSceneFrameLoop(
  paint: (dt: number, elapsed: number) => void,
  scheduler: TeamSceneFrameScheduler
): TeamSceneFrameLoop {
  let frameId: number | null = null
  let lastPaint: number | null = null
  let disposed = false

  const onFrame = (now: number): void => {
    frameId = scheduler.request(onFrame)
    if (lastPaint !== null && now - lastPaint < INTERVAL_MS) {
      return
    }
    const elapsed = lastPaint === null ? 0 : (now - lastPaint) / 1000
    lastPaint = now
    paint(Math.min(MAX_DT_SECONDS, elapsed), elapsed)
  }

  const stop = (): void => {
    if (frameId !== null) {
      scheduler.cancel(frameId)
    }
    frameId = null
    lastPaint = null
  }

  return {
    setRunning: (running) => {
      if (disposed || running === (frameId !== null)) {
        return
      }
      if (running) {
        frameId = scheduler.request(onFrame)
      } else {
        stop()
      }
    },
    dispose: () => {
      stop()
      disposed = true
    }
  }
}
