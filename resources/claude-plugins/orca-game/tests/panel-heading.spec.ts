import { beforeEach, describe, expect, it } from 'vitest'

import { cellWidthOf } from '../hooks/cell-width'
import { setGameLocale } from '../hooks/game-strings'
import { headingPartsOf, needCalloutsOf, statusPartsOf } from '../hooks/panel-heading'

const COUNTS = { working: 1, idle: 1, done: 0, waiting: 1 }
const textOf = (parts: { text: string }[]) => parts.map((one) => one.text).join(' ')

describe('panel heading', () => {
  beforeEach(() => setGameLocale('en'))

  it('splits a heading into its name and trailing count', () => {
    expect(headingPartsOf('My PRs 3')).toEqual({ name: 'My PRs', count: '3' })
    expect(headingPartsOf('Team 12')).toEqual({ name: 'Team', count: '12' })
    expect(headingPartsOf('Metrics')).toEqual({ name: 'Metrics', count: undefined })
    // Why: a name that only ends in a digit with no space before it keeps it.
    expect(headingPartsOf('Sprint42')).toEqual({ name: 'Sprint42', count: undefined })
  })

  it('labels every status with a glyph when the row has room', () => {
    const parts = statusPartsOf(COUNTS, 80)
    expect(textOf(parts)).toBe('● 1 working ○ 1 idle ✓ 0 done ▲ 1 waiting on you')
    expect(parts.map((one) => one.key)).toEqual(['working', 'idle', 'done', 'waiting'])
    expect(parts.find((one) => one.key === 'waiting')?.isAlert).toBe(true)
  })

  it('keeps only the needs-you label on a phone, then drops it too when even that overflows', () => {
    expect(textOf(statusPartsOf(COUNTS, 31))).toBe('● 1 ○ 1 ✓ 0 ▲ 1 waiting on you')
    expect(textOf(statusPartsOf(COUNTS, 16))).toBe('● 1 ○ 1 ✓ 0 ▲ 1')
  })

  it('never alerts with nobody waiting, and fits the room it is given', () => {
    const parts = statusPartsOf({ ...COUNTS, waiting: 0 }, 31)
    expect(parts.some((one) => one.isAlert)).toBe(false)
    for (const columns of [16, 31, 47, 80]) {
      const drawn = statusPartsOf(COUNTS, columns)
      expect(cellWidthOf(textOf(drawn)), `${columns}`).toBeLessThanOrEqual(Math.max(columns, 15))
    }
  })

  it('gives each member one callout that joins everything it needs, in order', () => {
    const callouts = needCalloutsOf([
      { name: 'Alex', text: 'waiting on you', url: null },
      { name: 'Wren', text: 'CI failing', url: 'https://x/2' },
      { name: 'Alex', text: 'CI failing', url: 'https://x/1' }
    ])
    expect(callouts).toEqual([
      { name: 'Alex', text: 'waiting on you · CI failing' },
      { name: 'Wren', text: 'CI failing' }
    ])
  })
})
