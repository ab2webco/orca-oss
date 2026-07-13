import { describe, expect, it, vi } from 'vitest'
import {
  LEGACY_WORKTREE_META_CONCURRENCY,
  runLegacyWorktreeMetaUpdates
} from './runtime-worktree-meta-fallback'

describe('legacy worktree metadata fallback', () => {
  it('bounds concurrency and waits for every row after a partial failure', async () => {
    const updates = Array.from({ length: 100 }, (_, index) => index)
    let active = 0
    let maxActive = 0
    const attempted = new Set<number>()
    const releaseFirstWave: (() => void)[] = []
    const updateOne = vi.fn(async (index: number) => {
      attempted.add(index)
      active += 1
      maxActive = Math.max(maxActive, active)
      if (index < LEGACY_WORKTREE_META_CONCURRENCY) {
        await new Promise<void>((resolve) => releaseFirstWave.push(resolve))
      }
      active -= 1
      if (index === 3) {
        throw new Error('row failed')
      }
    })

    const result = runLegacyWorktreeMetaUpdates(updates, updateOne)
    await vi.waitFor(() => expect(releaseFirstWave).toHaveLength(LEGACY_WORKTREE_META_CONCURRENCY))
    expect(maxActive).toBe(LEGACY_WORKTREE_META_CONCURRENCY)
    releaseFirstWave.forEach((release) => release())

    await expect(result).rejects.toThrow('legacy worktree metadata updates failed')
    expect(attempted.size).toBe(100)
    expect(active).toBe(0)
  })
})
