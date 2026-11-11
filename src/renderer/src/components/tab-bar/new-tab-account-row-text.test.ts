import { describe, expect, it } from 'vitest'
import type { NewTabAccountRow } from '../../../../shared/new-tab-account-choice'
import { newTabAccountRowTextOf } from './new-tab-account-row-text'

const row = (patch: Partial<NewTabAccountRow> = {}): NewTabAccountRow => ({
  id: 'acct-1',
  email: 'one@example.test',
  disabled: null,
  inUseBy: [],
  otherModel: false,
  usedPercent: 37,
  ...patch
})

// Why (ORCA-717): a reason in 2-3 words, never a sentence explaining the UI.
describe('newTabAccountRowTextOf', () => {
  it('reads the used percent of a free account', () => {
    expect(newTabAccountRowTextOf(row())).toEqual({ detail: '37% used', tag: null })
  })

  it('reads no reading when quota is unknown', () => {
    expect(newTabAccountRowTextOf(row({ usedPercent: null }))).toEqual({
      detail: 'No reading',
      tag: null
    })
  })

  it('names the reason a row is disabled instead of its percent', () => {
    expect(newTabAccountRowTextOf(row({ disabled: 'limited', usedPercent: 100 })).detail).toBe(
      'Limit reached'
    )
    expect(newTabAccountRowTextOf(row({ disabled: 'signed-out' })).detail).toBe('Signed out')
  })

  it('marks a custom endpoint as another model', () => {
    expect(newTabAccountRowTextOf(row({ otherModel: true, usedPercent: null })).detail).toBe(
      'Other model'
    )
  })

  it('tags the tickets of the members using it', () => {
    expect(newTabAccountRowTextOf(row({ inUseBy: ['NETSA-121', 'NETSA-9'] })).tag).toBe(
      'In use by NETSA-121, NETSA-9'
    )
  })
})
