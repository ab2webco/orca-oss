// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { PlaneWorkItem } from '../../../../shared/plane-types'
import {
  clearPlaneListSnapshots,
  readPlaneListSnapshot,
  writePlaneListSnapshot
} from './plane-list-snapshot-storage'

const STORAGE_KEY = 'orca.plane.work-item-list.v1'

function workItem(id: string, description = ''): PlaneWorkItem {
  return {
    id,
    identifier: id,
    sequenceId: 1,
    title: id,
    description,
    url: `https://plane.example/${id}`,
    project: { id: 'p-1', identifier: 'P', name: 'Project' },
    state: { id: 's-1', name: 'Todo', group: 'unstarted' },
    labels: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('Plane list snapshot storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a list under its scope and cache key', () => {
    writePlaneListSnapshot('local', 'k1', { data: [workItem('ORCA-1')], fetchedAt: 1_000 })
    expect(readPlaneListSnapshot('local', 'k1')).toEqual({
      data: [workItem('ORCA-1')],
      fetchedAt: 1_000
    })
    expect(readPlaneListSnapshot('runtime:env-9', 'k1')).toBeNull()
    expect(readPlaneListSnapshot('local', 'k2')).toBeNull()
  })

  it('keeps only the 8 most recent scopes', () => {
    for (let i = 0; i < 10; i += 1) {
      writePlaneListSnapshot('local', `k${i}`, { data: [workItem(`ORCA-${i}`)], fetchedAt: i })
    }
    const kept = Object.keys(
      (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { entries: object }).entries
    )
    expect(kept).toHaveLength(8)
    expect(kept).not.toContain('k0')
    expect(kept).toContain('k9')
  })

  it('evicts older scopes rather than exceeding the payload budget', () => {
    const list = (count: number): PlaneWorkItem[] =>
      Array.from({ length: count }, (_, i) => workItem(`ORCA-${i}`, 'x'.repeat(4_600)))
    writePlaneListSnapshot('local', 'old', { data: list(100), fetchedAt: 1 })
    writePlaneListSnapshot('local', 'big', { data: list(400), fetchedAt: 2 })

    expect((localStorage.getItem(STORAGE_KEY) ?? '').length).toBeLessThanOrEqual(2_000_000)
    expect(readPlaneListSnapshot('local', 'big')).not.toBeNull()
    expect(readPlaneListSnapshot('local', 'old')).toBeNull()
  })

  it('stores nothing when a single list cannot fit the payload budget', () => {
    const oversized = Array.from({ length: 600 }, (_, i) => workItem(`ORCA-${i}`, 'x'.repeat(5_000)))
    writePlaneListSnapshot('local', 'huge', { data: oversized, fetchedAt: 1 })
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('clears every scope', () => {
    writePlaneListSnapshot('local', 'k1', { data: [workItem('ORCA-1')], fetchedAt: 1 })
    clearPlaneListSnapshots()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
