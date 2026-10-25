import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/i18n/localized-catalog', () => ({
  createLocalizedCatalog:
    <T>(loader: () => T) =>
    () =>
      loader()
}))

vi.mock('./settings-search-keywords', () => ({
  translateSearchKeyword: (_key: string, fallback: string) => [fallback]
}))

import { getPrivacyPaneSearchEntries } from './privacy-search'

describe('getPrivacyPaneSearchEntries', () => {
  // The search index cannot read the build's transport gate, so it must not claim Orca Lab sends data.
  it('describes the usage-data toggle without claiming that Orca Lab sends events', () => {
    const entry = getPrivacyPaneSearchEntries().find(
      (candidate) => candidate.title === 'Share Anonymous Usage Data'
    )
    expect(entry?.description).toBe('Choose whether anonymous feature-usage events are shared.')
    expect(entry?.description).not.toMatch(/by sending/i)
  })
})
