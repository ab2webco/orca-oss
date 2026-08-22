// Frame scheduler for the startup-grid settle that survives a starved
// requestAnimationFrame (ORCA-279).
//
// The connect scheduler arms both a rAF and a 250ms timer because "Wayland/CI
// compositors can starve rAF while timers/CDP stay responsive". The startup-grid
// settle then cancels that timer and used to wait on rAF alone, so a pane with a
// startup command (a resumed agent, a setup split) never reached transport.connect
// wherever rAF was starved — no PTY, no error, forever. Racing each frame against a
// timer keeps the settle bounded by wall clock as well as by paint.

export type StartupGridFrameClock = {
  requestAnimationFrame: (callback: () => void) => number
  cancelAnimationFrame: (handle: number) => void
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
}

export type StartupGridFrameScheduler = {
  requestFrame: (callback: () => void) => number
  cancelFrame: (handle: number) => void
}

/** One frame at ~30fps: long enough to prefer a real paint, short enough that the
 *  12-frame settle budget still resolves well inside the connect's own deadlines. */
export const STARTUP_GRID_FRAME_STARVATION_MS = 32

type PendingFrame = {
  animationHandle: number | null
  timerHandle: ReturnType<typeof setTimeout> | null
  fired: boolean
}

export function createStartupGridFrameScheduler(
  clock: StartupGridFrameClock,
  starvationMs: number = STARTUP_GRID_FRAME_STARVATION_MS
): StartupGridFrameScheduler {
  const pending = new Map<number, PendingFrame>()
  let nextHandle = 1

  const release = (frame: PendingFrame): void => {
    if (frame.animationHandle !== null) {
      clock.cancelAnimationFrame(frame.animationHandle)
      frame.animationHandle = null
    }
    if (frame.timerHandle !== null) {
      clock.clearTimeout(frame.timerHandle)
      frame.timerHandle = null
    }
  }

  return {
    requestFrame: (callback) => {
      const handle = nextHandle
      nextHandle += 1
      const frame: PendingFrame = { animationHandle: null, timerHandle: null, fired: false }
      pending.set(handle, frame)
      const fire = (): void => {
        if (frame.fired) {
          return
        }
        frame.fired = true
        pending.delete(handle)
        release(frame)
        callback()
      }
      // Why registered before either handle is stored: a clock that dispatches
      // synchronously must still see `fired` and skip arming the loser.
      frame.animationHandle = clock.requestAnimationFrame(fire)
      if (!frame.fired) {
        frame.timerHandle = clock.setTimeout(fire, starvationMs)
      }
      return handle
    },
    cancelFrame: (handle) => {
      const frame = pending.get(handle)
      if (!frame) {
        return
      }
      frame.fired = true
      pending.delete(handle)
      release(frame)
    }
  }
}

export const startupGridFrameScheduler = createStartupGridFrameScheduler({
  requestAnimationFrame: (callback) => requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(handle)
    }
  },
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle)
})
