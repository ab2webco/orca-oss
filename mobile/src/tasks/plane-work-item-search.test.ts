import { describe, expect, it } from 'vitest'
import type { PlaneMobileWorkItem } from './plane-mobile-work-item-read'
import { filterPlaneWorkItemsByQuery, matchesPlaneWorkItemQuery } from './plane-work-item-search'

function card(overrides: Partial<PlaneMobileWorkItem> = {}): PlaneMobileWorkItem {
  return {
    id: 'wi-1',
    identifier: 'ORCA-169',
    title: 'The mobile search sends free text to a PQL endpoint',
    ...overrides
  } as unknown as PlaneMobileWorkItem
}

describe('matchesPlaneWorkItemQuery', () => {
  it('finds a card by the number a human types', () => {
    expect(matchesPlaneWorkItemQuery(card(), '169')).toBe(true)
  })

  it('finds it by the full identifier, however it is spelled', () => {
    expect(matchesPlaneWorkItemQuery(card(), 'ORCA-169')).toBe(true)
    expect(matchesPlaneWorkItemQuery(card(), 'orca-169')).toBe(true)
    expect(matchesPlaneWorkItemQuery(card(), 'orca 169')).toBe(true)
  })

  it('finds it by part of the title, case-insensitively', () => {
    expect(matchesPlaneWorkItemQuery(card(), 'PQL endpoint')).toBe(true)
  })

  it('rejects a number that belongs to no field of this card', () => {
    expect(matchesPlaneWorkItemQuery(card(), '4210')).toBe(false)
    expect(matchesPlaneWorkItemQuery(card(), 'linear')).toBe(false)
  })

  it('does not crash on a card the host sent without an identifier', () => {
    expect(matchesPlaneWorkItemQuery(card({ identifier: '' }), '169')).toBe(false)
    expect(matchesPlaneWorkItemQuery(card({ identifier: '' }), 'mobile')).toBe(true)
  })

  it('matches everything when the field is empty or blank', () => {
    expect(matchesPlaneWorkItemQuery(card(), '')).toBe(true)
    expect(matchesPlaneWorkItemQuery(card(), '   ')).toBe(true)
  })
})

describe('filterPlaneWorkItemsByQuery', () => {
  const rows = [card(), card({ id: 'wi-2', identifier: 'ORCA-417', title: 'Board spinner' })]

  it('keeps only the matching rows', () => {
    expect(filterPlaneWorkItemsByQuery(rows, '417').map((row) => row.id)).toEqual(['wi-2'])
  })

  it('keeps every row when nothing was typed', () => {
    expect(filterPlaneWorkItemsByQuery(rows, '  ')).toHaveLength(2)
  })
})
