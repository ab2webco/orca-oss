import { describe, expect, it } from 'vitest'

import {
  LOCALE_KEY_OVERRIDES,
  repairCatalog,
  repairTranslatedValue,
  shouldPreserveEnglishValue
} from './locale-translation-policy.mjs'

const repairEs = (key, enValue, localeValue) =>
  repairTranslatedValue({ key, enValue, localeValue, locale: 'es' })

describe('locale-translation-policy', () => {
  it('keeps agent catalog labels in English', () => {
    expect(repairEs('auto.lib.agent.catalog.760bc6883d', 'Codex', 'Códice')).toBe('Codex')
  })

  it('does not break Copy identifier when fixing Codex', () => {
    expect(repairEs('auto.components.example', 'Copy identifier', 'Copiar identificador')).toBe(
      'Copiar identificador'
    )
  })

  it('fixes the Gemini zodiac mistranslation in an agent label', () => {
    expect(repairEs('auto.lib.agent.catalog.12e6baa4f7', 'Gemini', 'Géminis')).toBe('Gemini')
  })

  it('preserves the orca URL scheme', () => {
    expect(repairEs('auto.web.WebConnect.27393856e4', 'orca://pair?code=...', 'orca://par')).toBe(
      'orca://pair?code=...'
    )
  })

  it('skips machine translation for standalone brands', () => {
    expect(shouldPreserveEnglishValue('Codex')).toBe(true)
    expect(shouldPreserveEnglishValue('Codex', 'auto.stats.StatsPane.7d26110cea')).toBe(true)
    expect(shouldPreserveEnglishValue('Show Codex usage')).toBe(false)
  })

  it('reverts a brand machine translation localized inside a sentence', () => {
    expect(repairEs('auto.components.example', 'Open in OpenCode', 'Abrir en código abierto')).toBe(
      'Abrir en OpenCode'
    )
  })

  it('rewrites "relaciones públicas" to PR only when English names a PR', () => {
    expect(repairEs('auto.components.example', 'Open PR', 'Abrir relaciones públicas')).toBe(
      'Abrir PR'
    )
    expect(repairEs('auto.components.example', 'Public relations', 'relaciones públicas')).toBe(
      'relaciones públicas'
    )
  })

  it('applies a Spanish value override', () => {
    expect(repairEs('auto.components.example', 'Explore Orca Lab', 'Explorar el laboratorio')).toBe(
      'Explorar Orca Lab'
    )
  })

  it('applies a Spanish key override on a consent surface', () => {
    expect(
      repairEs(
        'auto.components.settings.DeveloperPermissionsPane.statusGranted',
        'Granted',
        'Otorgado'
      )
    ).toBe('Concedido')
  })

  it('merges key overrides from every source', () => {
    expect(LOCALE_KEY_OVERRIDES['auto.hooks.useMacosTccPromptNotice.title']?.es).toBeTruthy()
    expect(
      LOCALE_KEY_OVERRIDES['auto.components.settings.PluginConsentDialog.decisionFailed']?.es
    ).toBeTruthy()
    expect(
      LOCALE_KEY_OVERRIDES['auto.components.settings.DeveloperPermissionsPane.statusGranted']?.es
    ).toBe('Concedido')
  })

  // Why: Orca Lab ships English and Spanish only (ORCA-596); no other locale has repair rules.
  it('carries no override for a locale Orca Lab no longer ships', () => {
    for (const overrides of Object.values(LOCALE_KEY_OVERRIDES)) {
      expect(Object.keys(overrides)).toEqual(['es'])
    }
  })

  it('writes the native Spanish name into the language picker', () => {
    const localeCatalog = { settings: { appearance: { language: { spanish: 'Spanish' } } } }
    expect(repairCatalog({}, localeCatalog, 'es')).toBe(1)
    expect(localeCatalog.settings.appearance.language.spanish).toBe('Español')
  })
})
