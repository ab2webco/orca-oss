import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n/i18n'
import { searchKeywords, translateSearchKeyword } from './settings-search-keywords'

describe('settings-search-keywords', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('returns only localized text in English UI', async () => {
    await i18n.changeLanguage('en')
    expect(translateSearchKeyword('settings.appearance.language.title', 'Language')).toEqual([
      'Language'
    ])
  })

  it('keeps English fallback and aliases in localized UI', async () => {
    await i18n.changeLanguage('es')
    expect(
      translateSearchKeyword('settings.appearance.language.title', 'Language', {
        aliases: ['locale']
      })
    ).toEqual(['Idioma', 'Language', 'locale'])
  })

  it('supports english-only keyword specs for brands', async () => {
    await i18n.changeLanguage('es')
    expect(searchKeywords([{ key: 'unused', fallback: 'github', englishOnly: true }])).toEqual([
      'github'
    ])
  })

  it('deduplicates repeated keyword variants', () => {
    expect(searchKeywords(['terminal', 'terminal', { key: 'k', fallback: 'terminal' }])).toEqual([
      'terminal'
    ])
  })

  it('indexes localized agent search synonyms in Spanish UI', async () => {
    await i18n.changeLanguage('es')
    expect(
      searchKeywords([
        { key: 'auto.components.settings.agents.search.66b6b82eb4', fallback: 'awake' }
      ])
    ).toEqual(['despierto', 'awake'])
    expect(
      searchKeywords([
        { key: 'auto.components.settings.agents.search.2afd3b5858', fallback: 'enable' }
      ])
    ).toEqual(['habilitar', 'enable'])
  })
})
