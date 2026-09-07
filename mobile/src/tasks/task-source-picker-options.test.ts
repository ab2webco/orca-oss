import { describe, expect, it } from 'vitest'
import { normalizePlaneFilter, PLANE_FILTER_OPTIONS } from './task-source-picker-options'
import {
  DEFAULT_PLANE_WORK_ITEM_FILTER,
  PLANE_WORK_ITEM_FILTER_LABELS,
  PLANE_WORK_ITEM_FILTER_ORDER
} from '../../../src/shared/plane-work-item-filter-labels'

/**
 * The mobile half of ORCA-460's control. The desktop half — the one that catches
 * a rename on the side that still writes its labels by hand — is
 * src/renderer/src/components/task-page-plane-filter-label-parity.test.ts.
 */
describe('the Plane filter picker', () => {
  it('shows every id under the label both clients use', () => {
    expect(PLANE_FILTER_OPTIONS.map((option) => [option.value, option.label])).toEqual(
      PLANE_WORK_ITEM_FILTER_ORDER.map((id) => [id, PLANE_WORK_ITEM_FILTER_LABELS[id]])
    )
  })

  it('says out loud which one hides done items', () => {
    const byValue = new Map(PLANE_FILTER_OPTIONS.map((option) => [option.value, option]))

    expect(byValue.get('everything')?.label).toBe('All')
    expect(byValue.get('all')?.label).toBe('All Open')
    // The subtitle was the only place mobile said this, and it said it wrong:
    // 'everything' is any state, not archived projects.
    expect(byValue.get('everything')?.subtitle).toBe('Any state, open or closed')
  })

  it('falls back to the filter desktop also opens on', () => {
    expect(normalizePlaneFilter(undefined)).toBe(DEFAULT_PLANE_WORK_ITEM_FILTER)
    expect(normalizePlaneFilter('not-a-filter')).toBe('everything')
    expect(normalizePlaneFilter('done')).toBe('done')
  })
})
