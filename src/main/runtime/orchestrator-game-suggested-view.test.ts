import { describe, expect, it } from 'vitest'

import { createGameSuggestedView } from './orchestrator-game-suggested-view'

const GIB = 1024 ** 3

describe('the suggested view a game state carries', () => {
  it('reads the host memory at most once a minute and coalesces concurrent reads', async () => {
    let at = 0
    let reads = 0
    const suggested = createGameSuggestedView({
      read: async () => {
        reads += 1
        return { totalMemory: 32 * GIB, availableMemory: reads === 1 ? 6 * GIB : 1 * GIB }
      },
      now: () => at
    })

    expect(await Promise.all([suggested(), suggested()])).toEqual(['2d-hd', '2d-hd'])
    at = 59_000
    expect(await suggested()).toBe('2d-hd')
    expect(reads).toBe(1)
    at = 61_000
    expect(await suggested()).toBe('flat')
    expect(reads).toBe(2)
  })

  it('leaves the flag out when the host memory cannot be read', async () => {
    const suggested = createGameSuggestedView({
      read: async () => {
        throw new Error('no vm_stat')
      },
      now: () => 0
    })

    expect(await suggested()).toBeUndefined()
  })
})
