import { describe, expect, it } from 'vitest'

import {
  UI_LANGUAGE_ENGLISH,
  UI_LANGUAGE_SPANISH,
  UI_LANGUAGE_SYSTEM,
  normalizeUiLanguage
} from './ui-language'

describe('normalizeUiLanguage', () => {
  it('accepts supported language settings', () => {
    expect(normalizeUiLanguage(UI_LANGUAGE_SYSTEM)).toBe('system')
    expect(normalizeUiLanguage(UI_LANGUAGE_ENGLISH)).toBe('en')
    expect(normalizeUiLanguage(UI_LANGUAGE_SPANISH)).toBe('es')
  })

  it('migrates a stored Chinese, Korean or Japanese setting to English', () => {
    expect(normalizeUiLanguage('zh')).toBe('en')
    expect(normalizeUiLanguage('ko')).toBe('en')
    expect(normalizeUiLanguage('ja')).toBe('en')
  })

  it('falls back unknown values to system', () => {
    expect(normalizeUiLanguage('fr')).toBe('system')
    expect(normalizeUiLanguage(null)).toBe('system')
  })
})
