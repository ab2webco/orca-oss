import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchRuntimeSocketLiveness } from './runtime-socket-liveness-watch'

describe('watchRuntimeSocketLiveness', () => {
  const watches: { stop: () => void }[] = []
  afterEach(() => {
    watches.splice(0).forEach((watch) => watch.stop())
    vi.restoreAllMocks()
  })

  function watch({
    hasEndpoint = () => true,
    rebind = vi.fn(async () => {}),
    dropped = () => 0
  }: {
    hasEndpoint?: () => boolean
    rebind?: () => Promise<void>
    dropped?: () => number
  } = {}) {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const handle = watchRuntimeSocketLiveness({
      hasEndpoint,
      rebind,
      describe: () => ({
        activeConnections: 64,
        droppedConnections: dropped(),
        lastServerError: null
      }),
      pollIntervalMs: 60_000
    })
    watches.push(handle)
    return { handle, rebind }
  }

  it('reports connections the cap turned away once, and never rebinds for them', async () => {
    let dropped = 3
    const { handle, rebind } = watch({ dropped: () => dropped })
    await handle.check()
    await handle.check()
    dropped = 5
    await handle.check()

    expect(rebind).not.toHaveBeenCalled()
    expect(vi.mocked(console.warn).mock.calls.map(([line]) => line)).toEqual([
      '[runtime] Local RPC socket turned away 3 connection(s) at its cap:',
      '[runtime] Local RPC socket turned away 2 connection(s) at its cap:'
    ])
  })

  it('rebinds on the first check that finds the socket file gone', async () => {
    const { handle, rebind } = watch({ hasEndpoint: () => false })
    await handle.check()
    expect(rebind).toHaveBeenCalledTimes(1)
  })

  it('never stacks a check behind a rebind still in flight', async () => {
    let finish: () => void = () => {}
    const rebind = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const { handle } = watch({ hasEndpoint: () => false, rebind })
    const first = handle.check()
    expect(handle.check()).toBe(first)
    finish()
    await first
    expect(rebind).toHaveBeenCalledTimes(1)
  })

  it('does nothing once stopped', async () => {
    const { handle, rebind } = watch({ hasEndpoint: () => false })
    handle.stop()
    await handle.check()
    expect(rebind).not.toHaveBeenCalled()
  })

  it('keeps watching after a rebind throws', async () => {
    const rebind = vi.fn(async () => {
      throw new Error('EADDRINUSE')
    })
    const { handle } = watch({ hasEndpoint: () => false, rebind })
    await handle.check()
    await handle.check()
    expect(rebind).toHaveBeenCalledTimes(2)
  })
})
