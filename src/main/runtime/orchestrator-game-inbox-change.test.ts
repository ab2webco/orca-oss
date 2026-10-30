import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameInboxChangeSignal } from './orchestrator-game-inbox-change'

afterEach(() => {
  vi.useRealTimers()
})

describe('GameInboxChangeSignal', () => {
  it('turns a burst of mail into one Inbox refresh, and a later burst into another', () => {
    vi.useFakeTimers()
    const emitted: number[] = []
    const signal = new GameInboxChangeSignal(() => emitted.push(Date.now()), 250)

    signal.mailArrived('question')
    signal.mailArrived('status')
    signal.mailArrived('worker_done')
    expect(emitted).toHaveLength(0)
    vi.advanceTimersByTime(250)
    expect(emitted).toHaveLength(1)

    signal.mailArrived('escalation')
    vi.advanceTimersByTime(250)
    expect(emitted).toHaveLength(2)
  })

  it('ignores heartbeats, which the Inbox never shows', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const signal = new GameInboxChangeSignal(emit, 250)

    signal.mailArrived('heartbeat')
    vi.advanceTimersByTime(1000)

    expect(emit).not.toHaveBeenCalled()
  })
})
