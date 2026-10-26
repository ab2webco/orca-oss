import { describe, expect, it } from 'vitest'

import { arcadeLoopOf, type ArcadeClock, type ArcadeScreen } from '../hooks/arcade-loop'
import { runnerOf, type RunnerState } from '../hooks/arcade-runner'
import { ARCADE_FPS_MAX, ARCADE_RUNNER } from '../hooks/arcade-runner-data'

// A clock the test advances by hand: every timer fires on its own period, in time order.
const fakeClock = () => {
  let now = 0
  const timers = new Set<{ ms: number; next: number; fn: () => void }>()
  const clock: ArcadeClock = {
    now: async () => now,
    every: (ms, fn) => {
      const timer = { ms, next: now + ms, fn }
      timers.add(timer)
      return () => timers.delete(timer)
    }
  }
  const advance = async (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = [...timers].sort((a, b) => a.next - b.next)[0]
      if (due === undefined || due.next > end) {
        break
      }
      now = due.next
      due.next += due.ms
      due.fn()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    now = end
  }
  return { clock, advance, timers }
}

const loopFor = (fps: number, isFocused = () => true) => {
  const { clock, advance, timers } = fakeClock()
  const frames: { state: RunnerState; screen: ArcadeScreen }[] = []
  const loop = arcadeLoopOf({
    runner: runnerOf({ ...ARCADE_RUNNER, fps }, [{ heights: [4, 4, 4, 4, 4], weight: 1 }]),
    seed: 1,
    clock,
    isActive: async () => isFocused(),
    draw: (state, screen) => frames.push({ state, screen })
  })
  return { loop, advance, timers, frames }
}

describe('the arcade loop', () => {
  it('runs no timer until the first press, and none once stopped', async () => {
    const { loop, advance, timers, frames } = loopFor(12)
    expect(timers.size).toBe(0)
    expect(frames.map((one) => one.screen)).toEqual(['ready'])
    await advance(5000)
    expect(frames).toHaveLength(1)
    loop.press()
    expect(timers.size).toBe(1)
    loop.stop()
    expect(timers.size).toBe(0)
  })

  it('draws at its own frame rate, never more than 15 a second', async () => {
    for (const fps of [5, 12, ARCADE_FPS_MAX, 30, 120]) {
      const { loop, advance, frames } = loopFor(fps)
      loop.press()
      // Why 1001: the last period of a second ends on 1000 ms give or take a float's last digit.
      await advance(1001)
      expect(frames.length - 1).toBe(Math.min(fps, ARCADE_FPS_MAX))
      loop.stop()
    }
  })

  it('pauses with no timer left when its pane loses the keyboard, and goes on at the next press', async () => {
    let isFocused = true
    const { loop, advance, timers, frames } = loopFor(12, () => isFocused)
    loop.press()
    await advance(500)
    isFocused = false
    await advance(500)
    expect(timers.size).toBe(0)
    const paused = frames.at(-1)!
    expect(paused.screen).toBe('paused')
    await advance(5000)
    expect(frames.at(-1)).toBe(paused)
    isFocused = true
    loop.press()
    expect(paused.state.jumpMs).toBeUndefined()
    await advance(100)
    expect(frames.at(-1)!.screen).toBe('running')
    expect(frames.at(-1)!.state.distance - paused.state.distance).toBeLessThan(2)
  })

  it('jumps on a press while running', async () => {
    const { loop, advance, frames } = loopFor(12)
    loop.press()
    await advance(200)
    loop.press()
    await advance(100)
    expect(frames.at(-1)!.state.jumpMs).toBeDefined()
  })

  it('stops its timer when the run ends, and a press starts a new run', async () => {
    const { loop, advance, timers, frames } = loopFor(12)
    loop.press()
    await advance(60_000)
    expect(frames.at(-1)!.screen).toBe('over')
    expect(timers.size).toBe(0)
    loop.press()
    await advance(100)
    expect(frames.at(-1)!.state.isOver).toBe(false)
    expect(frames.at(-1)!.state.distance).toBeLessThan(5)
  })
})
