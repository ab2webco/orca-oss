import { afterEach, describe, expect, it } from 'vitest'

import {
  CATALOGS,
  GAME_LOCALES,
  gameLocaleOf,
  gameStrings,
  isRasterText,
  setGameLocale,
  stringsOf,
  type ArtStrings,
  type TextStrings
} from '../hooks/game-strings'

afterEach(() => setGameLocale('en'))

// Every entry rendered with sample arguments, so a function entry is checked like a string one.
const rendered = (strings: TextStrings | ArtStrings): string[] =>
  Object.values(strings).flatMap((value: unknown) => {
    if (typeof value === 'string') {
      return [value]
    }
    if (typeof value === 'function') {
      const entry = value as (first: unknown, second: unknown) => string
      return [entry(2, 'x')]
    }
    return Object.values(value as Record<string, string>)
  })

describe('gameLocaleOf', () => {
  it('takes the five languages Orca ships, in any case or padding', () => {
    expect(GAME_LOCALES).toEqual(['en', 'es', 'ja', 'ko', 'zh'])
    expect(gameLocaleOf('es')).toBe('es')
    expect(gameLocaleOf(' JA ')).toBe('ja')
    expect(gameLocaleOf('zh')).toBe('zh')
  })

  it('reads anything else as English', () => {
    expect(gameLocaleOf(undefined)).toBe('en')
    expect(gameLocaleOf(null)).toBe('en')
    expect(gameLocaleOf('')).toBe('en')
    expect(gameLocaleOf('fr')).toBe('en')
    expect(gameLocaleOf('es-MX')).toBe('en')
  })
})

describe('the catalog', () => {
  it('translates every text string in every language', () => {
    const keys = Object.keys(CATALOGS.en.text ?? {}).sort()
    expect(keys.length).toBeGreaterThan(20)
    for (const locale of GAME_LOCALES) {
      expect(Object.keys(CATALOGS[locale].text ?? {}).sort()).toEqual(keys)
    }
  })

  it('falls back to English for a key a language leaves out', () => {
    expect(stringsOf('es').text).not.toEqual(stringsOf('en').text)
    expect(stringsOf('ja').art).toEqual(stringsOf('en').art)
  })

  it('speaks Spanish with tú and counts with the right plural', () => {
    const { text, art } = stringsOf('es')
    expect(text.teammates(1)).toBe('Equipo: 1 compañero')
    expect(text.teammates(3)).toBe('Equipo: 3 compañeros')
    expect(text.waiting(2)).toBe('2 te esperan')
    expect(text.waiting(1)).toBe('1 te espera')
    expect(text.couldNotOpen('builder')).toBe('No se pudo abrir el panel de builder')
    expect(art.alert('tester')).toBe('¡tester te necesita!')
  })

  // Why: a Raster takes only width-1 characters and refuses the whole frame otherwise.
  it('keeps every pixel-art string to width-1 characters, falling back to English', () => {
    for (const locale of GAME_LOCALES) {
      expect(rendered(stringsOf(locale).art).filter((one) => !isRasterText(one))).toEqual([])
    }
    expect(stringsOf('ja').art).toEqual(stringsOf('en').art)
    expect(stringsOf('es').art.thinking).toBe('pensando')
  })

  it('tells width-1 text from text a terminal draws two columns wide', () => {
    expect(isRasterText('¡Leyendo índice.ts! ♥ ★ … □■')).toBe(true)
    expect(isRasterText('考え中')).toBe(false)
    expect(isRasterText('생각 중')).toBe(false)
    expect(isRasterText('🎉')).toBe(false)
  })

  it('serves the language the session was launched with', () => {
    expect(gameStrings().text.close).toBe('Close')
    setGameLocale('ko')
    expect(gameStrings().text.close).toBe('닫기')
    expect(gameStrings().art.thinking).toBe('thinking')
  })
})
