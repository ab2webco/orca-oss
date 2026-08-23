import { describe, expect, it } from 'vitest'
import {
  AGENT_GRID_CELL_GAP,
  AGENT_GRID_MAX_COLUMNS,
  AGENT_GRID_MIN_CELL_WIDTH,
  resolveAgentGridCellSpans,
  resolveAgentGridColumns
} from './agent-grid-columns'

describe('resolveAgentGridColumns', () => {

  it('never opens more tracks than there are cards', () => {
    // A single agent in a wide pop-out is where the tail is least readable.
    expect(resolveAgentGridColumns(1400, 1)).toBe(1)
    expect(resolveAgentGridColumns(1400, 2)).toBe(2)
  })

  it('still fills the width when there are more cards than tracks', () => {
    expect(resolveAgentGridColumns(1400, 99)).toBe(resolveAgentGridColumns(1400))
  })
  // The reported failure: the pop-out's own default width rendered ONE column,
  // so eight agents were eight rows to scroll (ORCA-234).
  it('puts several cells on a row at the pop-out default width', () => {
    expect(resolveAgentGridColumns(936)).toBeGreaterThanOrEqual(2)
  })

  it('adds columns as the pop-out widens', () => {
    expect(resolveAgentGridColumns(1416)).toBeGreaterThan(resolveAgentGridColumns(936))
    expect(resolveAgentGridColumns(1416)).toBe(4)
  })

  it('never packs a cell narrower than its floor', () => {
    for (const width of [456, 700, 936, 1200, 1416, 1900]) {
      const columns = resolveAgentGridColumns(width)
      const used = columns * AGENT_GRID_MIN_CELL_WIDTH + (columns - 1) * AGENT_GRID_CELL_GAP
      expect(columns === 1 || used <= width).toBe(true)
    }
  })

  it('caps the count so a wide wall does not become a spreadsheet', () => {
    expect(resolveAgentGridColumns(10_000)).toBe(AGENT_GRID_MAX_COLUMNS)
  })

  it('answers one column for an unmeasured or degenerate container', () => {
    expect(resolveAgentGridColumns(0)).toBe(1)
    expect(resolveAgentGridColumns(-40)).toBe(1)
    expect(resolveAgentGridColumns(Number.NaN)).toBe(1)
    expect(resolveAgentGridColumns(120)).toBe(1)
  })
})

describe('resolveAgentGridCellSpans', () => {
  it('gives a lone cell in the last row the whole row', () => {
    // The owner's report: three agents across two tracks left a visible hole.
    expect(resolveAgentGridCellSpans(3, 2)).toEqual([1, 1, 2])
  })

  it('splits an incomplete last row evenly, remainder first', () => {
    expect(resolveAgentGridCellSpans(5, 3)).toEqual([1, 1, 1, 2, 1])
    expect(resolveAgentGridCellSpans(2, 3)).toEqual([2, 1])
  })

  it('leaves full rows alone', () => {
    expect(resolveAgentGridCellSpans(4, 2)).toEqual([1, 1, 1, 1])
    expect(resolveAgentGridCellSpans(1, 1)).toEqual([1])
  })
})
