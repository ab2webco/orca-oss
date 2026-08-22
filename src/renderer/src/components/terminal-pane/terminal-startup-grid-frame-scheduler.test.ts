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
}

function createFakeClock(): FakeClock {
  const frames = new Map<number, () => void>()
  const timers = new Map<number, { callback: () => void; dueAt: number }>()
  let nextFrame = 1
  let nextTimer = 1
  let now = 0

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
        timer.callback()
      }
    },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size
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
