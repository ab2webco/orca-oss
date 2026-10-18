import { describe, expect, it } from 'vitest'

import { cellWidthOf } from '../hooks/cell-width'
import {
  isTapLayout,
  TAP_LAYOUT_COLUMNS,
  TAP_ROWS,
  tapActionsOf,
  tapLabelOf
} from '../hooks/tap-layout'

describe('tap layout', () => {
  it('switches on below 60 body columns, a phone, and stays off from there up', () => {
    expect(TAP_LAYOUT_COLUMNS).toBe(60)
    expect(isTapLayout(40)).toBe(true)
    expect(isTapLayout(TAP_LAYOUT_COLUMNS - 1)).toBe(true)
    expect(isTapLayout(TAP_LAYOUT_COLUMNS)).toBe(false)
    expect(isTapLayout(76)).toBe(false)
    expect(isTapLayout(156)).toBe(false)
  })

  it('draws a label as two rows that each span the width', () => {
    const lines = tapLabelOf('✕ Close', 40).split('\n')
    expect(lines).toHaveLength(TAP_ROWS)
    expect(lines[0]).toBe(` ✕ Close${' '.repeat(32)}`)
    expect(lines.map(cellWidthOf)).toEqual([40, 40])
    expect(lines[1]?.trim()).toBe('')
  })

  it('starts the first row after a hotkey prefix and the second at the left edge', () => {
    const lines = tapLabelOf('✕ Close', 40, 3).split('\n')
    expect(lines.map(cellWidthOf)).toEqual([37, 40])
  })

  it('cuts a label wider than the width, wide glyphs counted as two cells', () => {
    const lines = tapLabelOf('▸ View · ORCA-601 The game lead delegates to members', 24).split('\n')
    expect(lines[0]).toMatch(/…\s*$/)
    expect(lines.map(cellWidthOf)).toEqual([24, 24])
    expect(tapLabelOf('▸ ゲーム画面を開く', 11).split('\n').map(cellWidthOf)).toEqual([11, 11])
  })

  it('keeps every action up to the cap, else one less and counts the rest', () => {
    expect(tapActionsOf(['a', 'b'], 2)).toEqual({ shown: ['a', 'b'], hidden: 0 })
    expect(tapActionsOf(['a', 'b', 'c', 'd'], 2)).toEqual({ shown: ['a'], hidden: 3 })
    expect(tapActionsOf([], 2)).toEqual({ shown: [], hidden: 0 })
  })
})
