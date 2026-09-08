import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n/i18n'
import { getPlanePresets } from './task-page-localized-options'
import {
  DEFAULT_PLANE_WORK_ITEM_FILTER,
  PLANE_WORK_ITEM_FILTER_LABELS,
  PLANE_WORK_ITEM_FILTER_ORDER
} from '../../../shared/plane-work-item-filter-labels'

/**
 * ORCA-460's control, and it has to sit on THIS side. Mobile builds its picker
 * out of the shared table, so mobile cannot drift; desktop names the same ids
 * through `translate()` string literals, so desktop can — and a control written
 * only against mobile would let the next desktop rename separate them again
 * with nobody noticing.
 *
 * What went wrong without it: `everything` read 'All' here and 'Everything'
 * there, `all` read 'All Open' here and 'All' there. Mobile's "All" therefore
 * showed only open items and users read the missing done cards as data loss.
 */
describe('a Plane filter id is named the same thing in both clients', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('gives every id the shared label, in the shared order', () => {
    expect(getPlanePresets()).toEqual(
      PLANE_WORK_ITEM_FILTER_ORDER.map((id) => ({ id, label: PLANE_WORK_ITEM_FILTER_LABELS[id] }))
    )
  })

  it('keeps the two ids the incident was about distinct', () => {
    const labels = new Map(getPlanePresets().map((preset) => [preset.id, preset.label]))

    // 'All' is every state; 'All Open' hides done. Naming either one after the
    // other is the bug, so they must never collapse to the same string.
    expect(labels.get('everything')).toBe('All')
    expect(labels.get('all')).toBe('All Open')
    expect(labels.get('everything')).not.toBe(labels.get('all'))
  })

  it('opens on the id both clients open on', () => {
    // Desktop opened on `everything` and mobile normalized to `all` — the same
    // split, in the default rather than the label.
    expect(DEFAULT_PLANE_WORK_ITEM_FILTER).toBe('everything')
    expect(getPlanePresets()[0]?.id).toBe(DEFAULT_PLANE_WORK_ITEM_FILTER)
  })
})
