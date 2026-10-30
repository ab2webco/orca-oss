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
