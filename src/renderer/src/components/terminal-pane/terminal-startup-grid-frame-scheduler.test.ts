import { describe, expect, it, vi } from 'vitest'
import {
  createStartupGridFrameScheduler,
  STARTUP_GRID_FRAME_STARVATION_MS,
  type StartupGridFrameClock
} from './terminal-startup-grid-frame-scheduler'
import { waitForStableStartupGrid } from './terminal-startup-grid-settle'

type FakeClock = StartupGridFrameClock & {
  /** Deliver every rAF callback currently queued. */
  paint: () => void
  /** Advance wall clock, delivering any timer whose delay has elapsed. */
  advance: (ms: number) => void
  pendingFrames: () => number
  pendingTimers: () => number
  timerWonFrames: () => number
}

function createFakeClock(): FakeClock {
  const frames = new Map<number, () => void>()
  const timers = new Map<number, { callback: () => void; dueAt: number }>()
  let nextFrame = 1
  let nextTimer = 1
  let now = 0
  let timerWon = 0

  return {
    requestAnimationFrame: (callback) => {
      const handle = nextFrame
      nextFrame += 1
      frames.set(handle, callback)
      return handle
    },
    cancelAnimationFrame: (handle) => {
      frames.delete(handle)
    },
    setTimeout: ((callback: () => void, delayMs: number) => {
      const handle = nextTimer
      nextTimer += 1
      timers.set(handle, { callback, dueAt: now + delayMs })
      return handle as unknown as ReturnType<typeof setTimeout>
    }) as StartupGridFrameClock['setTimeout'],
    clearTimeout: (handle) => {
      timers.delete(handle as unknown as number)
    },
    paint: () => {
      const queued = [...frames.entries()]
      frames.clear()
      for (const [, callback] of queued) {
        callback()
      }
    },
    advance: (ms) => {
      now += ms
      const due = [...timers.entries()].filter(([, timer]) => timer.dueAt <= now)
      for (const [handle] of due) {
        timers.delete(handle)
      }
      for (const [, timer] of due) {
        timerWon += 1
        timer.callback()
      }
    },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
    timerWonFrames: () => timerWon
  }
}

const STABLE_GRID = { cols: 80, rows: 24 }

describe('startup-grid frame scheduler', () => {
  it('settles the startup grid when requestAnimationFrame is starved', () => {
    const clock = createFakeClock()
    const scheduler = createStartupGridFrameScheduler(clock)
    const onSettled = vi.fn()

    waitForStableStartupGrid({
      isAlive: () => true,
      measure: () => STABLE_GRID,
      onSettled,
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame
    })

    // Never paint: this is the Wayland/CI compositor the connect fallback timer exists for.
    for (let tick = 0; tick < 20; tick += 1) {
      clock.advance(STARTUP_GRID_FRAME_STARVATION_MS)
    }

    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith(STABLE_GRID)
  })

  it('never settles on a starved rAF without the scheduler — the ORCA-279 regression', () => {
    const clock = createFakeClock()
    const onSettled = vi.fn()

    waitForStableStartupGrid({
      isAlive: () => true,
      measure: () => STABLE_GRID,
      onSettled,
      requestFrame: clock.requestAnimationFrame,
      cancelFrame: clock.cancelAnimationFrame
    })

    for (let tick = 0; tick < 20; tick += 1) {
      clock.advance(STARTUP_GRID_FRAME_STARVATION_MS)
    }

    expect(onSettled).not.toHaveBeenCalled()
  })

  it('lets a healthy compositor win every race, so the settle counts real frames', () => {
    const clock = createFakeClock()
    const scheduler = createStartupGridFrameScheduler(clock)
    const onSettled = vi.fn()
    let measured = { cols: 40, rows: 12 }

    waitForStableStartupGrid({
      isAlive: () => true,
      measure: () => measured,
      onSettled,
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame
    })

    // A 30Hz display is the slow end of healthy; every frame must still be a paint.
    for (let frame = 0; frame < 12 && onSettled.mock.calls.length === 0; frame += 1) {
      if (frame === 1) {
        measured = STABLE_GRID
      }
      clock.advance(33)
      clock.paint()
    }

    expect(onSettled).toHaveBeenCalledWith(STABLE_GRID)
    expect(clock.timerWonFrames()).toBe(0)
  })

  it('keeps the starvation fallback outside the paint budget', () => {
    // Why asserted: a fallback inside a frame interval would let the timer advance
    // the settle between paints, satisfying "stable" without a layout ever landing.
    expect(STARTUP_GRID_FRAME_STARVATION_MS).toBeGreaterThan(1000 / 30)
  })

  it('prefers a real paint and drops that frame timer, so a frame fires once', () => {
    const clock = createFakeClock()
    const scheduler = createStartupGridFrameScheduler(clock)
    const callback = vi.fn()

    scheduler.requestFrame(callback)
    expect(clock.pendingTimers()).toBe(1)

    clock.paint()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(clock.pendingTimers()).toBe(0)

    clock.advance(STARTUP_GRID_FRAME_STARVATION_MS * 4)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('drops the paint when the starvation timer wins, so a frame fires once', () => {
    const clock = createFakeClock()
    const scheduler = createStartupGridFrameScheduler(clock)
    const callback = vi.fn()

    scheduler.requestFrame(callback)
    clock.advance(STARTUP_GRID_FRAME_STARVATION_MS)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(clock.pendingFrames()).toBe(0)

    clock.paint()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('cancelFrame releases both the paint and the starvation timer', () => {
    const clock = createFakeClock()
    const scheduler = createStartupGridFrameScheduler(clock)
    const callback = vi.fn()

    const handle = scheduler.requestFrame(callback)
    scheduler.cancelFrame(handle)

    expect(clock.pendingFrames()).toBe(0)
    expect(clock.pendingTimers()).toBe(0)
    clock.paint()
    clock.advance(STARTUP_GRID_FRAME_STARVATION_MS * 4)
    expect(callback).not.toHaveBeenCalled()
  })

  it('keeps a settle cancellable mid-starvation', () => {
    const clock = createFakeClock()
    const scheduler = createStartupGridFrameScheduler(clock)
    const onSettled = vi.fn()

    const handle = waitForStableStartupGrid({
      isAlive: () => true,
      measure: () => STABLE_GRID,
      onSettled,
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame
    })

    clock.advance(STARTUP_GRID_FRAME_STARVATION_MS)
    handle.cancel()
    for (let tick = 0; tick < 20; tick += 1) {
      clock.advance(STARTUP_GRID_FRAME_STARVATION_MS)
    }

    expect(onSettled).not.toHaveBeenCalled()
    expect(clock.pendingTimers()).toBe(0)
  })
})
