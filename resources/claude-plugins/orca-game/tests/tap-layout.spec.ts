import { describe, expect, it } from 'vitest'

import { cellWidthOf } from '../hooks/cell-width'
import { MORE_CHIP_KEY } from '../hooks/chip-rows'
import {
  isTapLayout,
  TAP_LAYOUT_COLUMNS,
  TAP_MIN_CELLS,
  TAP_ROWS,
  tapChipOf,
  tapRowsOf
} from '../hooks/tap-layout'

const rowWidthOf = (row: readonly { width: number }[]): number =>
  row.reduce((sum, chip) => sum + chip.width, 0) + Math.max(0, row.length - 1)

describe('tap layout', () => {
  it('switches on below 60 body columns, a phone, and stays off from there up', () => {
    expect(TAP_LAYOUT_COLUMNS).toBe(60)
    expect(isTapLayout(40)).toBe(true)
    expect(isTapLayout(TAP_LAYOUT_COLUMNS - 1)).toBe(true)
    expect(isTapLayout(TAP_LAYOUT_COLUMNS)).toBe(false)
    expect(isTapLayout(76)).toBe(false)
    expect(isTapLayout(156)).toBe(false)
  })

  // The phone's xterm cell is 7.8 x 15 px at 13 px: 3 rows are 45 px and 6 cells 47 px, over 44 pt.
  it('sizes a chip to the 44 pt touch minimum and no wider than its label', () => {
    expect(TAP_ROWS).toBe(3)
    expect(TAP_MIN_CELLS).toBe(6)
  })

  it('draws a chip as its label on the middle of three rows, each as wide as the chip', () => {
    const lines = tapChipOf('✕ Close', 9).split('\n')
    expect(lines).toHaveLength(TAP_ROWS)
    expect(lines[1]).toBe(' ✕ Close ')
    expect(lines.map(cellWidthOf)).toEqual([9, 9, 9])
    expect(lines[0]?.trim()).toBe('')
    expect(lines[2]?.trim()).toBe('')
  })

  it('starts the first row after a hotkey prefix, the other two at the chip edge', () => {
    expect(tapChipOf('✕ Close', 9, 3).split('\n').map(cellWidthOf)).toEqual([6, 9, 9])
  })

  it('keeps a short label at least six cells wide, centred', () => {
    const [row] = tapRowsOf([{ key: 'r', priority: 0, labels: ['↻'] }], { columns: 40 })
    expect(row?.[0]?.width).toBe(TAP_MIN_CELLS)
    expect(tapChipOf(row?.[0]?.label ?? '', TAP_MIN_CELLS).split('\n')[1]).toBe('  ↻   ')
  })

  it('wraps chips into rows that fit, one cell between two', () => {
    const chips = ['▸ Wave', '▸ Status', '▸ Stop', '▸ Sweep', '▸ Release', '▸ Board'].map(
      (label, at) => ({ key: `a${at}`, priority: at, labels: [label] as const })
    )
    const rows = tapRowsOf(chips, { columns: 36 })
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.flat().map((one) => one.key)).toEqual(chips.map((one) => one.key))
    for (const row of rows) {
      expect(rowWidthOf(row)).toBeLessThanOrEqual(36)
    }
  })

  it('in one row shortens labels first, then counts the dropped chips in a +N', () => {
    const chips = [
      { key: 'panel', priority: 0, labels: ['▤ Panel'] as const },
      { key: 'refresh', priority: 1, labels: ['↻ Refresh', '↻'] as const },
      ...['▸ Wave', '▸ Status', '▸ Stop'].map((label, at) => ({
        key: `a${at}`,
        priority: 10 + at,
        labels: [label] as const
      }))
    ]
    const rows = tapRowsOf(chips, { columns: 36, maxRows: 1, more: (count) => `+${count}` })
    expect(rows).toHaveLength(1)
    const row = rows[0] ?? []
    expect(rowWidthOf(row)).toBeLessThanOrEqual(36)
    expect(row.map((one) => one.key).slice(0, 2)).toEqual(['panel', 'refresh'])
    const more = row.find((one) => one.key === MORE_CHIP_KEY)
    const kept = row.filter((one) => /^a\d$/.test(one.key)).length
    expect(more?.label.trim()).toBe(`+${3 - kept}`)
    expect(more?.width).toBeGreaterThanOrEqual(TAP_MIN_CELLS)
  })
})
