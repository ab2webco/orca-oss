import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  settleTeardownWithinDeadline,
  WILL_QUIT_TEARDOWN_DEADLINE_MS
} from './quit-teardown-deadline'

describe('settleTeardownWithinDeadline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves as soon as all teardowns settle, including rejections', async () => {
    vi.useFakeTimers()
    let resolved = false
    const pending = settleTeardownWithinDeadline([
      { name: 'daemon', promise: Promise.resolve() },
      { name: 'runtime-rpc', promise: Promise.reject(new Error('daemon disconnect failed')) }
    ]).then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(0)
    await pending
    expect(resolved).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports the teardowns still pending at the deadline', async () => {
    vi.useFakeTimers()
    const pending = settleTeardownWithinDeadline([
      { name: 'daemon', promise: Promise.resolve() },
      { name: 'runtime-rpc', promise: new Promise(() => {}) }
    ])
    await vi.advanceTimersByTimeAsync(WILL_QUIT_TEARDOWN_DEADLINE_MS - 1)
    let resolved = false
    void pending.then(() => {
      resolved = true
    })
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual(['runtime-rpc'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports each member settle time and the members still pending at the report mark', async () => {
    vi.useFakeTimers()
    const settledEvents: [string, number, string][] = []
    const pendingReports: [string[], number][] = []
    let releaseDaemon: () => void = () => {}
    const pending = settleTeardownWithinDeadline(
      [
        { name: 'state', promise: Promise.reject(new Error('disk')) },
        { name: 'daemon', promise: new Promise<void>((resolve) => (releaseDaemon = resolve)) }
      ],
      WILL_QUIT_TEARDOWN_DEADLINE_MS,
      {
        memberSettled: (name, elapsedMs, outcome) => settledEvents.push([name, elapsedMs, outcome]),
        stillPending: (names, elapsedMs) => pendingReports.push([names, elapsedMs]),
        pendingReportMs: 5_000
      }
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(pendingReports).toEqual([[['daemon'], 5_000]])
    releaseDaemon()
    await expect(pending).resolves.toEqual([])
    expect(settledEvents).toEqual([
      ['state', 0, 'rejected'],
      ['daemon', 5_000, 'fulfilled']
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('skips the pending report when every member settled before it', async () => {
    vi.useFakeTimers()
    const stillPending = vi.fn()
    await settleTeardownWithinDeadline(
      [{ name: 'daemon', promise: Promise.resolve() }],
      WILL_QUIT_TEARDOWN_DEADLINE_MS,
      { stillPending, pendingReportMs: 5_000 }
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(stillPending).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  // Why: pin the magnitude so the wedge escape hatch cannot be silently
  // shrunk below checkpoint-write time or grown past user patience.
  it('keeps the deadline within the checkpoint-safe window', () => {
    expect(WILL_QUIT_TEARDOWN_DEADLINE_MS).toBeGreaterThanOrEqual(10_000)
    expect(WILL_QUIT_TEARDOWN_DEADLINE_MS).toBeLessThanOrEqual(30_000)
  })
})
