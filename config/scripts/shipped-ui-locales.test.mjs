import { describe, expect, it } from 'vitest'

import { DEFAULT_UI_LOCALE, SUPPORTED_UI_LOCALES } from '../../src/shared/ui-locale'
import { SHIPPED_TARGET_LOCALES, isShippedCatalogFile } from './shipped-ui-locales.mjs'

describe('shipped UI locales', () => {
  it('match the locales the app resolves, minus English', () => {
    expect(SHIPPED_TARGET_LOCALES).toEqual(
      SUPPORTED_UI_LOCALES.filter((locale) => locale !== DEFAULT_UI_LOCALE)
    )
  })

  it('recognize a shipped catalog file and nothing else', () => {
    expect(isShippedCatalogFile('es.json')).toBe(true)
    expect(isShippedCatalogFile('zh.json')).toBe(false)
    expect(isShippedCatalogFile('en.json')).toBe(false)
  })
})
