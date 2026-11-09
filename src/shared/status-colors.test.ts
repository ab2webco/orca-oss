import { describe, expect, it } from 'vitest'
import { normalizeStatusColorOverrides } from './status-colors'

describe('normalizeStatusColorOverrides', () => {
  it('keeps six-digit hex colours per theme and tone, lowercased', () => {
    expect(
      normalizeStatusColorOverrides({ light: { info: '#0369A1' }, dark: { attention: '#ff6568' } })
    ).toEqual({ light: { info: '#0369a1' }, dark: { attention: '#ff6568' } })
  })

  it('drops anything that is not a known theme, tone or hex colour', () => {
    expect(
      normalizeStatusColorOverrides({
        light: { info: 'red', success: '#12345', warning: '#abcdef;}body{x:y' },
        dark: { crown: '#ffffff' },
        sepia: { info: '#000000' }
      })
    ).toEqual({})
  })

  it('returns an empty object for a missing or malformed value', () => {
    expect(normalizeStatusColorOverrides(undefined)).toEqual({})
    expect(normalizeStatusColorOverrides('#ffffff')).toEqual({})
    expect(normalizeStatusColorOverrides({ light: null })).toEqual({})
  })
})
