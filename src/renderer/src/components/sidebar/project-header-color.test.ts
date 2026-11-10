import { describe, expect, it } from 'vitest'
import { DEFAULT_REPO_BADGE_COLOR, REPO_COLORS } from '../../../../shared/constants'
import { resolveRepoHeaderColor } from './project-header-color'

describe('resolveRepoHeaderColor', () => {
  it('returns a canonical palette color', () => {
    expect(resolveRepoHeaderColor(REPO_COLORS[3])).toBe(REPO_COLORS[3])
  })

  it('keeps the default repo badge color gray', () => {
    expect(resolveRepoHeaderColor(DEFAULT_REPO_BADGE_COLOR)).toBe(DEFAULT_REPO_BADGE_COLOR)
  })

  it.each([undefined, null, ''])('falls back for missing or empty input: %s', (badgeColor) => {
    expect(resolveRepoHeaderColor(badgeColor)).toBe(DEFAULT_REPO_BADGE_COLOR)
  })

  it('normalizes whitespace and casing to the canonical palette value', () => {
    expect(resolveRepoHeaderColor(`  ${REPO_COLORS[4].toUpperCase()}  `)).toBe(REPO_COLORS[4])
  })

  it('returns normalized custom hex colors', () => {
    expect(resolveRepoHeaderColor(' #123ABC ')).toBe('#123abc')
  })

  it('falls back for invalid colors', () => {
    expect(resolveRepoHeaderColor('blue')).toBe(DEFAULT_REPO_BADGE_COLOR)
  })
})
