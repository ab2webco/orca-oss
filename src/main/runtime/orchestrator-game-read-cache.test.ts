import { describe, expect, it } from 'vitest'
import { GameReadCache } from './orchestrator-game-read-cache'

describe('GameReadCache', () => {
  it('shares one load per key within the TTL and loads again after it', async () => {
    let now = 0
    let loads = 0
    const cache = new GameReadCache<number>(60_000, () => now)
    const load = async () => {
      loads += 1
      return loads
    }

    expect(await Promise.all([cache.read('a', load), cache.read('a', load)])).toEqual([1, 1])
    now = 59_999
    expect(await cache.read('a', load)).toBe(1)
    now = 60_000
    expect(await cache.read('a', load)).toBe(2)
    expect(await cache.read('b', load)).toBe(3)
  })

  it('answers null for a load that fails, and keeps that answer until the TTL ends', async () => {
    const cache = new GameReadCache<number>(1000, () => 0)
    expect(
      await cache.read('a', async () => {
        throw new Error('offline')
      })
    ).toBeNull()
    expect(await cache.read('a', async () => 7)).toBeNull()
  })
})

describe('GameReadCache with a changing TTL', () => {
  it('keeps an entry as long as the TTL says at the time of the read', async () => {
    let now = 0
    let ttl = 60_000
    let loads = 0
    const cache = new GameReadCache<number>(
      () => ttl,
      () => now
    )
    const load = async () => (loads += 1)

    await cache.read('a', load)
    ttl = 300_000
    now = 120_000
    expect(await cache.read('a', load)).toBe(1)
    ttl = 60_000
    expect(await cache.read('a', load)).toBe(2)
  })
})

// Why: an expired member-PR entry made the lead's game.state wait on GitHub for 2-16 s (ORCA-1199).
describe('GameReadCache refreshing in the background', () => {
  it('answers an expired entry with its last value at once and reloads it once behind', async () => {
    let now = 0
    let release: (value: number) => void = () => {}
    const loads: number[] = []
    const cache = new GameReadCache<number>(60_000, () => now, { refreshInBackground: true })

    expect(await cache.read('a', async () => (loads.push(1), 1))).toBe(1)
    now = 60_000
    const slow = (): Promise<number> => {
      loads.push(2)
      return new Promise((resolve) => (release = resolve))
    }
    expect(await cache.read('a', slow)).toBe(1)
    expect(await cache.read('a', slow)).toBe(1)
    expect(loads).toEqual([1, 2])

    release(2)
    await Promise.resolve()
    await Promise.resolve()
    expect(await cache.read('a', slow)).toBe(2)
    expect(loads).toEqual([1, 2])
  })

  // Review L2: Retry now's fresh read must not be overwritten by a reload that began before it.
  it('drops a background reload that lands after the key was forgotten and read again', async () => {
    let now = 0
    let release: (value: number) => void = () => {}
    const cache = new GameReadCache<number>(60_000, () => now, { refreshInBackground: true })
    await cache.read('a', async () => 1)
    now = 60_000
    await cache.read('a', () => new Promise<number>((resolve) => (release = resolve)))

    cache.forget('a')
    expect(await cache.read('a', async () => 3)).toBe(3)
    release(2)
    await Promise.resolve()
    await Promise.resolve()
    expect(await cache.read('a', async () => 4)).toBe(3)
  })

  it('still waits for the first load of a key, which has no last value', async () => {
    let release: (value: number) => void = () => {}
    const cache = new GameReadCache<number>(60_000, () => 0, { refreshInBackground: true })
    let settled = false
    const first = cache
      .read('a', () => new Promise<number>((resolve) => (release = resolve)))
      .then((value) => ((settled = true), value))
    await Promise.resolve()
    expect(settled).toBe(false)
    release(5)
    expect(await first).toBe(5)
  })
})

describe('GameReadCache entries in flight', () => {
  it('shares a first load still in flight past its TTL instead of loading again', async () => {
    let now = 0
    let release: (value: number) => void = () => {}
    let loads = 0
    const cache = new GameReadCache<number>(60_000, () => now, { refreshInBackground: true })
    const load = (): Promise<number> => {
      loads += 1
      return new Promise((resolve) => (release = resolve))
    }
    const first = cache.read('a', load)
    now = 120_000
    const second = cache.read('a', load)
    release(3)
    expect(await Promise.all([first, second])).toEqual([3, 3])
    expect(loads).toBe(1)
  })

  it('never lets an older load that lands late replace a newer one', async () => {
    let now = 0
    const releases: ((value: number) => void)[] = []
    const cache = new GameReadCache<number>(60_000, () => now)
    const load = (): Promise<number> => new Promise((resolve) => releases.push(resolve))
    const old = cache.read('a', load)
    now = 60_000
    const fresh = cache.read('a', load)
    releases[1]?.(2)
    expect(await fresh).toBe(2)
    releases[0]?.(1)
    expect(await old).toBe(1)
    expect(await cache.read('a', load)).toBe(2)
  })
})
