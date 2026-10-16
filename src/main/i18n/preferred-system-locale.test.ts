import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  preferred: [] as string[],
  locale: 'en-US'
}))

vi.mock('electron', () => ({
  app: {
    getPreferredSystemLanguages: vi.fn(() => electron.preferred),
    getLocale: vi.fn(() => electron.locale)
  }
}))

import { getPreferredSystemLocale } from './main-i18n'

describe('getPreferredSystemLocale', () => {
  beforeEach(() => {
    electron.preferred = []
    electron.locale = 'en-US'
  })

  // Why: on macOS app.getLocale() follows the app bundle's localizations, so a Spanish Mac reads en.
  it("follows the person's first preferred system language over the app bundle's locale", () => {
    electron.preferred = ['es-CO', 'en-CO']
    expect(getPreferredSystemLocale()).toBe('es-CO')
  })

  it("falls back to the app's locale when the system names no preferred language", () => {
    electron.locale = 'ja-JP'
    expect(getPreferredSystemLocale()).toBe('ja-JP')
  })
})
