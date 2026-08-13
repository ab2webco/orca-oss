import { describe, expect, it, vi } from 'vitest'

import { enqueueGitHubProjectFieldWrite } from './github-project-field-write-queue'

describe('enqueueGitHubProjectFieldWrite', () => {
  it('serializes writes for the same row and field after a failed write', async () => {
    let rejectFirst: (error: Error) => void = () => {}
    const firstPending = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const first = vi.fn(() => firstPending)
    const second = vi.fn(async () => 'newest')
    const identity = { cacheKey: 'view', rowId: 'row', fieldId: 'status' }

    const firstResult = enqueueGitHubProjectFieldWrite(identity, first)
    const secondResult = enqueueGitHubProjectFieldWrite(identity, second)

    await Promise.resolve()
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    rejectFirst(new Error('older write failed'))
    await expect(firstResult).rejects.toThrow('older write failed')
    await expect(secondResult).resolves.toBe('newest')
    expect(second).toHaveBeenCalledOnce()
  })

  it('does not block writes for another row or field', async () => {
    let releaseFirst: () => void = () => {}
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const other = vi.fn(async () => 'other')

    const firstResult = enqueueGitHubProjectFieldWrite(
      { cacheKey: 'view', rowId: 'row', fieldId: 'status' },
      () => firstPending
    )
    const otherResult = enqueueGitHubProjectFieldWrite(
      { cacheKey: 'view', rowId: 'other-row', fieldId: 'status' },
      other
    )

    await expect(otherResult).resolves.toBe('other')
    expect(other).toHaveBeenCalledOnce()
    releaseFirst()
    await firstResult
  })
})
