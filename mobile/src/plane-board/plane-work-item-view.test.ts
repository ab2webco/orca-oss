import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: vi.fn(async (key: string) => entries.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      entries.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      entries.delete(key)
    })
  }
})

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))

import {
  loadPlaneWorkItemView,
  normalizePlaneWorkItemView,
  resolvePlaneWorkItemView,
  savePlaneWorkItemView,
  usePlaneViewMode,
  type PlaneViewMode
} from './plane-work-item-view'

const KEY = 'orca:plane.work-item-view.v1'

describe('plane work item view', () => {
  beforeEach(() => {
    storage.entries.clear()
    storage.getItem.mockClear()
    storage.setItem.mockClear()
    storage.removeItem.mockClear()
  })

  it('reads list as the default view', () => {
    expect(resolvePlaneWorkItemView(undefined)).toEqual({ viewMode: 'list' })
  })

  it.each([
    ['a bare string', 'board'],
    ['an array', ['board']],
    ['an unknown mode', { viewMode: 'kanban' }],
    ['a non-string mode', { viewMode: 1 }],
    ['null', null]
  ])('tolerates %s on read and falls back to list', (_label, raw) => {
    expect(resolvePlaneWorkItemView(raw)).toEqual({ viewMode: 'list' })
  })

  it('keeps a stored board view', () => {
    expect(resolvePlaneWorkItemView({ viewMode: 'board' })).toEqual({ viewMode: 'board' })
  })

  it('normalizes the default view to nothing, so a reset clears the key', async () => {
    expect(normalizePlaneWorkItemView({ viewMode: 'list' })).toBeUndefined()
    storage.entries.set(KEY, JSON.stringify({ viewMode: 'board' }))

    await savePlaneWorkItemView({ viewMode: 'list' })

    expect(storage.removeItem).toHaveBeenCalledWith(KEY)
    expect(storage.entries.has(KEY)).toBe(false)
  })

  it('round-trips the board view through device storage', async () => {
    await savePlaneWorkItemView({ viewMode: 'board' })

    expect(storage.entries.get(KEY)).toBe(JSON.stringify({ viewMode: 'board' }))
    await expect(loadPlaneWorkItemView()).resolves.toEqual({ viewMode: 'board' })
  })

  it('reads corrupt JSON as the default instead of throwing', async () => {
    storage.entries.set(KEY, '{not json')

    await expect(loadPlaneWorkItemView()).resolves.toEqual({ viewMode: 'list' })
  })

  it('reads the default when storage itself fails', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(loadPlaneWorkItemView()).resolves.toEqual({ viewMode: 'list' })
  })

  it('swallows a failed write so the live view keeps working', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(savePlaneWorkItemView({ viewMode: 'board' })).resolves.toBeUndefined()
  })

  it('does not let a late stored view override a choice the user already made', async () => {
    // The read resolves after the user has picked, so touchedRef must win over it.
    let resolveGet: (value: string | null) => void = () => {}
    storage.getItem.mockImplementationOnce(
      () => new Promise<string | null>((resolve) => (resolveGet = resolve))
    )
    let api: [PlaneViewMode, (mode: PlaneViewMode) => void] | null = null
    function Probe() {
      api = usePlaneViewMode()
      return null
    }
    act(() => {
      create(createElement(Probe))
    })

    act(() => api![1]('board'))
    expect(api![0]).toBe('board')

    await act(async () => {
      resolveGet(JSON.stringify({ viewMode: 'list' }))
      await Promise.resolve()
    })

    expect(api![0]).toBe('board')
  })
})
