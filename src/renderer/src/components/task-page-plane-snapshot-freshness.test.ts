import { describe, expect, it } from 'vitest'

import {
  formatPlaneSnapshotAge,
  isPlaneSnapshotStale,
  resolvePlanePaneLoadPhase,
  resolvePlanePaneSeedState
} from './task-page-plane-snapshot-freshness'

describe('resolvePlanePaneSeedState', () => {
  const items = [{ id: 'a' }, { id: 'b' }]

  it('shows the cached list immediately instead of a blocking skeleton', () => {
    expect(resolvePlanePaneSeedState({ data: items, fetchedAt: 1_700_000_000 })).toEqual({
      seededItems: items,
      seededFetchedAt: 1_700_000_000,
      blocking: false
    })
  })

  // The TTL governs refetching, never rendering: this is what makes a second
  // entry after the 2-minute TTL instant instead of a cold load.
  it('still seeds from an entry far older than the cache ttl', () => {
    const ancient = { data: items, fetchedAt: 0 }
    expect(resolvePlanePaneSeedState(ancient).blocking).toBe(false)
    expect(resolvePlanePaneSeedState(ancient).seededItems).toEqual(items)
  })

  // Control for the whole fix: with the cache gone the blocking skeleton MUST
  // come back. If this ever returns blocking:false, the seeding proves nothing.
  it('blocks when there is no cached entry at all', () => {
    expect(resolvePlanePaneSeedState(null)).toEqual({
      seededItems: null,
      seededFetchedAt: null,
      blocking: true
    })
    expect(resolvePlanePaneSeedState(undefined).blocking).toBe(true)
  })

  it('blocks on an entry whose data is null rather than blanking the pane', () => {
    expect(resolvePlanePaneSeedState({ data: null, fetchedAt: 5 })).toEqual({
      seededItems: null,
      seededFetchedAt: null,
      blocking: true
    })
  })

  it('seeds an empty result without blocking, so "no work items" is reachable', () => {
    expect(resolvePlanePaneSeedState({ data: [], fetchedAt: 42 })).toEqual({
      seededItems: [],
      seededFetchedAt: 42,
      blocking: false
    })
  })
})

describe('resolvePlanePaneLoadPhase', () => {
  it('blocks only when a fetch is in flight with nothing cached to show', () => {
    expect(resolvePlanePaneLoadPhase({ hasSeed: false, inFlight: true })).toBe('cold')
  })

  it('keeps cached content on screen while revalidating instead of blocking', () => {
    expect(resolvePlanePaneLoadPhase({ hasSeed: true, inFlight: true })).toBe('revalidating')
  })

  it('settles once the fetch finishes', () => {
    expect(resolvePlanePaneLoadPhase({ hasSeed: true, inFlight: false })).toBe('settled')
    expect(resolvePlanePaneLoadPhase({ hasSeed: false, inFlight: false })).toBe('settled')
  })
})

describe('formatPlaneSnapshotAge', () => {
  const now = 1_000_000_000

  it('returns null without a snapshot so no timestamp is rendered', () => {
    expect(formatPlaneSnapshotAge(null, now)).toBeNull()
    expect(formatPlaneSnapshotAge(undefined, now)).toBeNull()
    expect(formatPlaneSnapshotAge(Number.NaN, now)).toBeNull()
  })

  it('scales the unit with the elapsed time', () => {
    expect(formatPlaneSnapshotAge(now - 5_000, now)).toBe('just now')
    expect(formatPlaneSnapshotAge(now - 120_000, now)).toBe('2m ago')
    expect(formatPlaneSnapshotAge(now - 7_200_000, now)).toBe('2h ago')
    expect(formatPlaneSnapshotAge(now - 172_800_000, now)).toBe('2d ago')
  })

  it('clamps a future timestamp rather than rendering a negative age', () => {
    expect(formatPlaneSnapshotAge(now + 60_000, now)).toBe('just now')
  })
})

describe('isPlaneSnapshotStale', () => {
  const now = 1_000_000_000

  it('is stale once the entry is older than the ttl', () => {
    expect(isPlaneSnapshotStale(now - 120_000, now, 120_000)).toBe(true)
    expect(isPlaneSnapshotStale(now - 119_999, now, 120_000)).toBe(false)
  })

  it('is not stale without a snapshot', () => {
    expect(isPlaneSnapshotStale(null, now, 120_000)).toBe(false)
  })
})
