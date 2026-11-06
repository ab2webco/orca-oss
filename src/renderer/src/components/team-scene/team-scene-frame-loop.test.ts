import { describe, expect, it } from 'vitest'
import { createTeamSceneFrameLoop, type TeamSceneFrameScheduler } from './team-scene-frame-loop'

function fakeScheduler() {
  let next = 1
  const pending = new Map<number, (now: number) => void>()
  const scheduler: TeamSceneFrameScheduler = {
    request: (cb) => {
      pending.set(next, cb)
      return next++
    },
    cancel: (id) => {
      pending.delete(id)
    }
  }
  const frame = (now: number): void => {
    const callbacks = [...pending.values()]
    pending.clear()
    for (const cb of callbacks) {
      cb(now)
    }
  }
  return { scheduler, frame, pending }
}

describe('createTeamSceneFrameLoop', () => {
  it('paints at most 30 times a second on a 60 Hz display', () => {
    const { scheduler, frame } = fakeScheduler()
    const dts: number[] = []
    const loop = createTeamSceneFrameLoop((dt) => dts.push(dt), scheduler)
    loop.setRunning(true)
    for (let i = 0; i <= 60; i++) {
      frame(i * (1000 / 60))
    }
    expect(dts.length).toBeGreaterThanOrEqual(29)
    expect(dts.length).toBeLessThanOrEqual(31)
    expect(dts[0]).toBe(0)
  })

  it('stops painting and holds no frame while stopped', () => {
    const { scheduler, frame, pending } = fakeScheduler()
    let paints = 0
    const loop = createTeamSceneFrameLoop(() => paints++, scheduler)
    loop.setRunning(true)
    frame(0)
    loop.setRunning(false)
    expect(pending.size).toBe(0)
    frame(100)
    expect(paints).toBe(1)
  })

  it('resumes without replaying the time it was hidden', () => {
    const { scheduler, frame } = fakeScheduler()
    const dts: number[] = []
    const loop = createTeamSceneFrameLoop((dt) => dts.push(dt), scheduler)
    loop.setRunning(true)
    frame(0)
    frame(40)
    loop.setRunning(false)
    loop.setRunning(true)
    frame(10_000)
    expect(dts).toEqual([0, 0.04, 0])
  })

  it('hands the real time since the last paint beside the capped step', () => {
    const { scheduler, frame } = fakeScheduler()
    const paints: [number, number][] = []
    const loop = createTeamSceneFrameLoop((dt, elapsed) => paints.push([dt, elapsed]), scheduler)
    loop.setRunning(true)
    // A slow runner at 3.5 frames a second.
    frame(0)
    frame(286)
    frame(572)
    expect(paints).toEqual([
      [0, 0],
      [0.05, 0.286],
      [0.05, 0.286]
    ])
  })

  it('ignores every call after dispose', () => {
    const { scheduler, frame, pending } = fakeScheduler()
    let paints = 0
    const loop = createTeamSceneFrameLoop(() => paints++, scheduler)
    loop.setRunning(true)
    loop.dispose()
    loop.setRunning(true)
    frame(0)
    expect(paints).toBe(0)
    expect(pending.size).toBe(0)
  })
})
