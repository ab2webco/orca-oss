import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameFleetChangeSignal } from './orchestrator-game-fleet-change'

afterEach(() => {
  vi.useRealTimers()
})

describe('GameFleetChangeSignal', () => {
  it('turns a burst of fleet changes into one new version, and wakes a waiter on it', async () => {
    vi.useFakeTimers()
    const signal = new GameFleetChangeSignal(250)
    const since = signal.version()

    const woken = signal.wait(since, 20_000)
    signal.changed()
    signal.changed()
    signal.changed()
    vi.advanceTimersByTime(250)

    await expect(woken).resolves.toEqual({ version: since + 1, changed: true })
    expect(signal.version()).toBe(since + 1)
  })

  it('answers at once when the fleet changed since the version the caller saw', async () => {
    vi.useFakeTimers()
    const signal = new GameFleetChangeSignal(250)
    signal.changed()
    vi.advanceTimersByTime(250)

    await expect(signal.wait(0, 20_000)).resolves.toEqual({ version: 1, changed: true })
  })

  it('answers unchanged after a quiet timeout', async () => {
    vi.useFakeTimers()
    const signal = new GameFleetChangeSignal(250)
    const quiet = signal.wait(0, 1000)

    vi.advanceTimersByTime(1000)

    await expect(quiet).resolves.toEqual({ version: 0, changed: false })
  })

  it('wakes a caller whose version came from a host that restarted since', async () => {
    const signal = new GameFleetChangeSignal(250)

    await expect(signal.wait(7, 20_000)).resolves.toEqual({ version: 0, changed: true })
  })

  // Why: the open Team panel re-reads on the push instead of its 20 s poll (ORCA-1441).
  it('pushes each new version once, after its burst', () => {
    vi.useFakeTimers()
    const onVersion = vi.fn()
    const signal = new GameFleetChangeSignal(250, onVersion)

    signal.changed()
    signal.changed()
    vi.advanceTimersByTime(249)
    expect(onVersion).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onVersion).toHaveBeenCalledTimes(1)

    signal.changed()
    vi.advanceTimersByTime(250)
    expect(onVersion).toHaveBeenCalledTimes(2)
    expect(signal.version()).toBe(2)
  })
})
