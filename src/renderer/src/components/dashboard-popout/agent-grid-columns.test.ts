import { describe, expect, it } from 'vitest'
import {
  AGENT_GRID_CELL_GAP,
  AGENT_GRID_MAX_COLUMNS,
  AGENT_GRID_MIN_CELL_WIDTH,
  resolveAgentGridColumns
} from './agent-grid-columns'

describe('resolveAgentGridColumns', () => {
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
