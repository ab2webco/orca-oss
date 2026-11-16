import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { formatShortActivityAge } from './short-activity-age'

const NOW = 100 * 24 * 60 * 60 * 1000
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const ago = (ms: number): string | null => formatShortActivityAge(NOW - ms, NOW)

describe('formatShortActivityAge', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows no age for a workspace with no activity timestamp', () => {
    expect(formatShortActivityAge(0, NOW)).toBeNull()
    expect(formatShortActivityAge(-1, NOW)).toBeNull()
  })

  describe('in English', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('en')
    })

    it('reads minutes, hours, days and weeks at their boundaries', () => {
      expect(ago(30_000)).toBe('now')
      expect(ago(MIN)).toBe('1 min')
      expect(ago(59 * MIN)).toBe('59 min')
      expect(ago(HOUR)).toBe('1 h')
      expect(ago(23 * HOUR + 59 * MIN)).toBe('23 h')
      expect(ago(DAY)).toBe('1 d')
      expect(ago(6 * DAY + 23 * HOUR)).toBe('6 d')
      expect(ago(7 * DAY)).toBe('1 wk')
      expect(ago(21 * DAY)).toBe('3 wk')
    })

    it('treats a clock skewed into the future as now', () => {
      expect(ago(-5 * MIN)).toBe('now')
    })
  })

  describe('in Spanish', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('es')
    })

    it('reads the short ages the mock-up draws', () => {
      expect(ago(30_000)).toBe('ahora')
      expect(ago(MIN)).toBe('1 min')
      expect(ago(4 * MIN)).toBe('4 min')
      expect(ago(59 * MIN)).toBe('59 min')
      expect(ago(5 * HOUR)).toBe('5 h')
      expect(ago(23 * HOUR)).toBe('23 h')
      expect(ago(DAY)).toBe('1 d')
      expect(ago(3 * DAY)).toBe('3 d')
      expect(ago(6 * DAY)).toBe('6 d')
      expect(ago(7 * DAY)).toBe('1 sem')
      expect(ago(21 * DAY)).toBe('3 sem')
    })
  })
})
