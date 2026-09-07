import { describe, expect, it } from 'vitest'
import {
  PLANE_DATE_CLEAR_UNSUPPORTED_ERROR,
  resolvePlaneDateSave,
  resolvePlaneLabelsSave,
  resolvePlaneTitleSave,
  shouldSavePlaneDescription
} from './plane-work-item-field-drafts'

describe('plane work item field drafts', () => {
  it('sends a trimmed title and discards an empty or unchanged one', () => {
    expect(resolvePlaneTitleSave({ draft: '  Renamed ', stored: 'One' })).toEqual({
      title: 'Renamed'
    })
    expect(resolvePlaneTitleSave({ draft: '   ', stored: 'One' })).toBeNull()
    expect(resolvePlaneTitleSave({ draft: 'One', stored: 'One' })).toBeNull()
  })

  it('sends a description only when it differs from the stored one, absent reading as empty', () => {
    expect(shouldSavePlaneDescription({ draft: '', stored: undefined })).toBe(false)
    expect(shouldSavePlaneDescription({ draft: 'Body', stored: 'Body' })).toBe(false)
    expect(shouldSavePlaneDescription({ draft: 'Body', stored: undefined })).toBe(true)
    expect(shouldSavePlaneDescription({ draft: '', stored: 'Body' })).toBe(true)
  })

  it('splits the label ids on commas and skips a set the card already has', () => {
    expect(resolvePlaneLabelsSave({ draft: ' l-ui, l-bug ,, ', stored: ['l-ui'] })).toEqual({
      labelIds: ['l-ui', 'l-bug']
    })
    expect(resolvePlaneLabelsSave({ draft: 'l-bug, l-ui', stored: ['l-ui', 'l-bug'] })).toBeNull()
    expect(resolvePlaneLabelsSave({ draft: '', stored: ['l-ui'] })).toEqual({ labelIds: [] })
    expect(resolvePlaneLabelsSave({ draft: '', stored: undefined })).toBeNull()
  })

  it('accepts a real YYYY-MM-DD date and refuses one that does not exist', () => {
    expect(
      resolvePlaneDateSave({ draft: ' 2026-09-30 ', stored: undefined, clearable: true })
    ).toEqual({
      value: '2026-09-30'
    })
    expect(
      resolvePlaneDateSave({ draft: '2026-02-30', stored: undefined, clearable: true })
    ).toEqual({
      error: 'Use the YYYY-MM-DD format'
    })
    expect(
      resolvePlaneDateSave({ draft: '30/09/2026', stored: undefined, clearable: true })
    ).toEqual({
      error: 'Use the YYYY-MM-DD format'
    })
  })

  it('clears a stored date on an empty draft and skips an unchanged or still-empty one', () => {
    expect(resolvePlaneDateSave({ draft: '', stored: '2026-09-10', clearable: true })).toEqual({
      value: null
    })
    // Why: an older host drops the null and answers ok, so the phone would show a clear Plane never took.
    expect(resolvePlaneDateSave({ draft: '', stored: '2026-09-10', clearable: false })).toEqual({
      error: PLANE_DATE_CLEAR_UNSUPPORTED_ERROR
    })
    expect(resolvePlaneDateSave({ draft: '', stored: undefined, clearable: false })).toBeNull()
    expect(resolvePlaneDateSave({ draft: '', stored: undefined, clearable: true })).toBeNull()
    expect(resolvePlaneDateSave({ draft: '', stored: null, clearable: true })).toBeNull()
    expect(
      resolvePlaneDateSave({ draft: '2026-09-10', stored: '2026-09-10', clearable: true })
    ).toBeNull()
  })
})
