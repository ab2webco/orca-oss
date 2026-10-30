import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchRuntimeSocketLiveness } from './runtime-socket-liveness-watch'

function scriptedProbe(results: (string | null)[]): () => Promise<string | null> {
  return vi.fn(async () => results.shift() ?? null)
}

describe('watchRuntimeSocketLiveness', () => {
  const watches: { stop: () => void }[] = []
  afterEach(() => {
    watches.splice(0).forEach((watch) => watch.stop())
    vi.restoreAllMocks()
  })

  function watch(probe: () => Promise<string | null>, rebind = vi.fn(async () => {})) {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const handle = watchRuntimeSocketLiveness({
      probe,
      rebind,
      describe: () => ({}),
      pollIntervalMs: 60_000
    })
    watches.push(handle)
    return { handle, rebind }
  }

  it('rebinds only after three consecutive failed probes', async () => {
    const { handle, rebind } = watch(scriptedProbe(['EPIPE', 'EPIPE', 'ENOENT']))
    await handle.check()
    await handle.check()
    expect(rebind).not.toHaveBeenCalled()
    await handle.check()
    expect(rebind).toHaveBeenCalledTimes(1)
  })

  it('forgets earlier failures once the socket answers', async () => {
    const { handle, rebind } = watch(scriptedProbe(['EPIPE', 'EPIPE', null, 'EPIPE', 'EPIPE']))
    for (let i = 0; i < 5; i += 1) {
      await handle.check()
    }
    expect(rebind).not.toHaveBeenCalled()
  })

  it('never stacks a probe behind one still in flight', async () => {
    let answer: (value: string | null) => void = () => {}
    const probe = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          answer = resolve
        })
    )
    const { handle } = watch(probe)
    const first = handle.check()
    const second = handle.check()
    expect(second).toBe(first)
    answer(null)
    await first
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('does not rebind from a probe that settles after stop', async () => {
    const { handle, rebind } = watch(scriptedProbe(['EPIPE', 'EPIPE', 'EPIPE']))
    await handle.check()
    await handle.check()
    const pending = handle.check()
    handle.stop()
    await pending
    expect(rebind).not.toHaveBeenCalled()
  })

  it('keeps watching after a rebind throws', async () => {
    const rebind = vi.fn(async () => {
      throw new Error('EADDRINUSE')
    })
    const { handle } = watch(
      scriptedProbe(['EPIPE', 'EPIPE', 'EPIPE', 'EPIPE', 'EPIPE', 'EPIPE']),
      rebind
    )
    for (let i = 0; i < 6; i += 1) {
      await handle.check()
    }
    expect(rebind).toHaveBeenCalledTimes(2)
  })
})
