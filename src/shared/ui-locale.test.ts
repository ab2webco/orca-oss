import { describe, expect, it } from 'vitest'

import {
  SUPPORTED_UI_LOCALES,
  normalizeSupportedUiLocale,
  resolveUiLocale,
  resolveRendererUiLocale
} from './ui-locale'
import { UI_LANGUAGE_ENGLISH, UI_LANGUAGE_SPANISH, UI_LANGUAGE_SYSTEM } from './ui-language'

describe('ui-locale', () => {
  it('ships English and Spanish only', () => {
    expect(SUPPORTED_UI_LOCALES).toEqual(['en', 'es'])
  })

  it('normalizes English locale prefixes', () => {
    expect(normalizeSupportedUiLocale('en-US')).toBe('en')
    expect(normalizeSupportedUiLocale('en_GB')).toBe('en')
  })

  it('normalizes Spanish locale prefixes', () => {
    expect(normalizeSupportedUiLocale('es-ES')).toBe('es')
    expect(normalizeSupportedUiLocale('es-MX')).toBe('es')
    expect(normalizeSupportedUiLocale('es')).toBe('es')
  })

  it('falls back unsupported locales to English', () => {
    expect(normalizeSupportedUiLocale('fr-FR')).toBe('en')
    expect(normalizeSupportedUiLocale(undefined)).toBe('en')
  })

  it('falls back Chinese locales to English', () => {
    expect(normalizeSupportedUiLocale('zh')).toBe('en')
    expect(normalizeSupportedUiLocale('zh-CN')).toBe('en')
    expect(normalizeSupportedUiLocale('zh-Hans')).toBe('en')
    expect(normalizeSupportedUiLocale('zh-TW')).toBe('en')
    expect(normalizeSupportedUiLocale('zh_HK')).toBe('en')
  })

  it('falls back Korean locales to English', () => {
    expect(normalizeSupportedUiLocale('ko')).toBe('en')
    expect(normalizeSupportedUiLocale('ko-KR')).toBe('en')
  })

  it('falls back Japanese locales to English', () => {
    expect(normalizeSupportedUiLocale('ja')).toBe('en')
    expect(normalizeSupportedUiLocale('ja-JP')).toBe('en')
  })

  it('resolves explicit English independently of system locale', () => {
    expect(resolveUiLocale(UI_LANGUAGE_ENGLISH, 'es-MX')).toBe('en')
  })

  it('resolves explicit Spanish independently of system locale', () => {
    expect(resolveUiLocale(UI_LANGUAGE_SPANISH, 'en-US')).toBe('es')
  })

  it('preserves a selected plugin language bundle id', () => {
    expect(resolveUiLocale('plugin:orca-samples.portuguese/pt-BR')).toBe(
      'plugin:orca-samples.portuguese/pt-BR'
    )
  })

  it('maps system locale to the closest supported locale', () => {
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'en-GB')).toBe('en')
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'es-MX')).toBe('es')
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'fr-FR')).toBe('en')
  })

  it('resolves a Chinese, Korean or Japanese system to English', () => {
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'zh-CN')).toBe('en')
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'ko-KR')).toBe('en')
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'ja-JP')).toBe('en')
  })

  it('uses renderer system locale only for the system setting', () => {
    expect(resolveRendererUiLocale(UI_LANGUAGE_ENGLISH)).toBe('en')
    expect(resolveRendererUiLocale(UI_LANGUAGE_SPANISH)).toBe('es')
  })
})
