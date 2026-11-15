import { describe, expect, it } from 'vitest'
import {
  STATUS_COLOR_BACKGROUND,
  STATUS_COLOR_DEFAULTS,
  STATUS_COLOR_TONES,
  normalizeStatusColorOverrides,
  statusColorWarning
} from './status-colors'

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

describe('statusColorWarning', () => {
  const dark = STATUS_COLOR_DEFAULTS.dark

  it('stays quiet for the defaults', () => {
    for (const tone of STATUS_COLOR_TONES) {
      expect(statusColorWarning(tone, dark, STATUS_COLOR_BACKGROUND.dark), tone).toBeNull()
    }
  })

  it('names the tone a colour is too close to', () => {
    const palette = { ...dark, warning: '#ff6a6a' }
    expect(statusColorWarning('warning', palette, STATUS_COLOR_BACKGROUND.dark)).toEqual({
      kind: 'close',
      other: 'attention'
    })
  })

  it('flags a colour that cannot be read on the background', () => {
    const palette = { ...dark, info: '#1a1a2a' }
    expect(statusColorWarning('info', palette, STATUS_COLOR_BACKGROUND.dark)).toEqual({
      kind: 'contrast'
    })
  })
})
