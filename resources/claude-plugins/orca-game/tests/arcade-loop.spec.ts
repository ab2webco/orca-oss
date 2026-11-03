import { describe, expect, it } from 'vitest'

import { arcadeLoopOf, type ArcadeScreen } from '../hooks/arcade-loop'
import { runnerOf, type RunnerState } from '../hooks/arcade-runner'
import { ARCADE_FPS_MAX, ARCADE_RUNNER } from '../hooks/arcade-runner-data'
import { fakeClock } from './arcade-clock'

const loopFor = (fps: number, isFocused = () => true, isHeld = () => false) => {
  const { clock, advance, timers } = fakeClock()
  const frames: { state: RunnerState; screen: ArcadeScreen; best: number }[] = []
  const loop = arcadeLoopOf({
    runner: runnerOf({ ...ARCADE_RUNNER, fps }, [{ heights: [4, 4, 4, 4, 4], weight: 1 }]),
    seed: 1,
    clock,
    isActive: async () => isFocused(),
    isHeld,
    draw: (state, screen, best) => frames.push({ state, screen, best })
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
    expect(paused.state.air).toBeUndefined()
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
    expect(frames.at(-1)!.state.air).toBeDefined()
  })

  it('takes off at the moment of the press, not at the next frame', async () => {
    const { loop, advance, frames } = loopFor(12)
    loop.press()
    await advance(200)
    loop.press()
    await advance(60)
    expect(frames.at(-1)!.state.air?.ms).toBeCloseTo(50, 5)
  })

  it('plays two presses between frames as a double jump', async () => {
    const { loop, advance, frames } = loopFor(12)
    loop.press()
    await advance(200)
    loop.press()
    await advance(30)
    loop.press()
    await advance(30)
    expect(frames.at(-1)!.state.air?.jumps).toBe(2)
    expect(frames.at(-1)!.state.air?.ms).toBeCloseTo(20, 5)
  })

  it('keeps the best score across runs', async () => {
    const { loop, advance, frames } = loopFor(12)
    loop.press()
    await advance(60_000)
    const over = frames.at(-1)!
    expect(over.best).toBe(over.state.score)
    loop.press()
    await advance(100)
    expect(frames.at(-1)!.best).toBe(over.state.score)
    expect(frames.at(-1)!.state.score).toBeLessThan(over.state.score)
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

  it('freezes a run while someone needs the user, with no frames, and goes on by itself once answered', async () => {
    let isHeld = false
    const { loop, advance, timers, frames } = loopFor(
      12,
      () => true,
      () => isHeld
    )
    loop.press()
    await advance(500)
    isHeld = true
    await advance(200)
    const held = frames.at(-1)!
    expect(held.screen).toBe('held')
    expect(timers.size).toBe(1)
    loop.press()
    await advance(5000)
    expect(frames.at(-1)).toBe(held)
    expect(held.state.air).toBeUndefined()
    isHeld = false
    await advance(1100)
    expect(frames.at(-1)!.screen).toBe('running')
    expect(frames.at(-1)!.state.distance).toBeGreaterThan(held.state.distance)
    loop.stop()
    expect(timers.size).toBe(0)
  })
})
