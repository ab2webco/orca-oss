import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGameLeadHandlesPoller } from './game-lead-handles'

const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createGameLeadHandlesPoller', () => {
  it('reads the live leads once for every sidebar card and stops with the last one', async () => {
    const readLeads = vi.fn(async () => [{ handle: 'term-lead' }])
    const published: ReadonlySet<string>[] = []
    const poller = createGameLeadHandlesPoller(
      readLeads,
      (handles) => published.push(handles),
      30_000
    )

    const releaseA = poller.subscribe('local', { kind: 'local' })
    const releaseB = poller.subscribe('local', { kind: 'local' })
    await flush()
    expect(readLeads).toHaveBeenCalledTimes(1)
    expect([...published.at(-1)!]).toEqual(['term-lead'])

    releaseA()
    releaseB()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(readLeads).toHaveBeenCalledTimes(1)
  })

  it('keeps the last leads when a read fails', async () => {
    const readLeads = vi
      .fn()
      .mockResolvedValueOnce([{ handle: 'term-lead' }])
      .mockRejectedValueOnce(new Error('timeout'))
    const published: ReadonlySet<string>[] = []
    const poller = createGameLeadHandlesPoller(
      readLeads,
      (handles) => published.push(handles),
      30_000
    )
    poller.subscribe('local', { kind: 'local' })
    await flush()

    await vi.advanceTimersByTimeAsync(30_000)

    expect([...published.at(-1)!]).toEqual(['term-lead'])
  })

  it('clears the crown when the host changes', async () => {
    const readLeads = vi.fn(async () => [{ handle: 'term-lead' }])
    const published: ReadonlySet<string>[] = []
    const poller = createGameLeadHandlesPoller(
      readLeads,
      (handles) => published.push(handles),
      30_000
    )
    poller.subscribe('local', { kind: 'local' })
    await flush()

    poller.subscribe('env-1', { kind: 'environment', environmentId: 'env-1' })

    expect(published.at(-1)?.size).toBe(0)
  })
})
