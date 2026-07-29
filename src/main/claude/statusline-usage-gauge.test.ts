import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLAUDE_STATUSLINE_ITEMS,
  type ClaudeStatusLineItems
} from '../../shared/claude-statusline-items'
import {
  deriveStatusLineBarCells,
  statuslineBarLevelsAscii,
  statuslineBarLevelsUnicode
} from './statusline-usage-gauge'

function items(overrides: Partial<ClaudeStatusLineItems>): ClaudeStatusLineItems {
  return { ...DEFAULT_CLAUDE_STATUSLINE_ITEMS, ...overrides }
}

describe('deriveStatusLineBarCells', () => {
  it('keeps the 5-cell baseline for the default item set', () => {
    // Why: the default set adds the project field, which spends what nothing else freed.
    expect(deriveStatusLineBarCells(DEFAULT_CLAUDE_STATUSLINE_ITEMS)).toBe(5)
  })

  it('keeps parity with the legacy line when project is off and nothing else changed', () => {
    expect(deriveStatusLineBarCells(items({ project: false }))).toBe(5)
  })

  it('grows the bars with the columns a disabled item frees', () => {
    expect(deriveStatusLineBarCells(items({ project: false, resetCountdown: false }))).toBe(8)
  })

  it('caps at 10 cells no matter how much width is freed', () => {
    expect(
      deriveStatusLineBarCells(
        items({ project: false, resetCountdown: false, sevenDayQuota: false })
      )
    ).toBe(10)
    expect(
      deriveStatusLineBarCells(
        items({
          project: false,
          resetCountdown: false,
          sevenDayQuota: false,
          fiveHourQuota: false,
          account: false
        })
      )
    ).toBe(10)
  })

  it('never grows past what the freed columns actually pay for', () => {
    // The enabled project costs more than the disabled account frees.
    expect(deriveStatusLineBarCells(items({ account: false }))).toBe(5)
  })

  it('returns the floor when no bar is enabled at all', () => {
    expect(
      deriveStatusLineBarCells(
        items({ context: false, fiveHourQuota: false, sevenDayQuota: false })
      )
    ).toBe(5)
  })
})

describe('statuslineBarLevels', () => {
  it('renders the legacy 5-cell table unchanged', () => {
    expect(statuslineBarLevelsUnicode(5)).toEqual([
      '░░░░░',
      '▌░░░░',
      '█░░░░',
      '█▌░░░',
      '██░░░',
      '██▌░░',
      '███░░',
      '███▌░',
      '████░',
      '████▌',
      '█████'
    ])
  })

  it('keeps every level at the requested width and fills only at level 10', () => {
    for (let cells = 5; cells <= 10; cells += 1) {
      const unicode = statuslineBarLevelsUnicode(cells)
      const ascii = statuslineBarLevelsAscii(cells)
      expect(unicode).toHaveLength(11)
      for (const [level, bar] of unicode.entries()) {
        expect([...bar]).toHaveLength(cells)
        expect(ascii[level]).toHaveLength(cells)
        // Why floor semantics matter: only a true 100% may show the all-full bar.
        if (level < 10) {
          expect(bar).not.toBe('█'.repeat(cells))
        }
      }
      expect(unicode[10]).toBe('█'.repeat(cells))
      expect(unicode[0]).toBe('░'.repeat(cells))
    }
  })

  it('keeps the ascii and unicode tables aligned level for level', () => {
    for (let cells = 5; cells <= 10; cells += 1) {
      const ascii = statuslineBarLevelsAscii(cells)
      for (const [level, unicode] of statuslineBarLevelsUnicode(cells).entries()) {
        expect(ascii[level].replaceAll('#', '█').replaceAll('=', '▌').replaceAll('.', '░')).toBe(
          unicode
        )
      }
    }
  })
})
