import { describe, expect, it } from 'vitest'

import { cellWidthOf } from '../hooks/cell-width'
import { listTableOf } from '../hooks/project-list-table'

const ITEMS = [
  {
    id: '843',
    title: 'feat(game): Panel cards and metrics',
    url: 'u',
    status: 'CI pending',
    tone: 'pending' as const
  },
  {
    id: '839',
    title: 'fix(game): remote member idle state',
    url: 'u',
    status: 'CI failed',
    tone: 'danger' as const
  },
  {
    id: '1836',
    title: 'feat(env): orca environment placement set',
    url: 'u',
    status: 'Approved',
    tone: 'success' as const
  }
]

describe('project list table', () => {
  it('aligns ids and statuses in columns as wide as their widest cell', () => {
    const table = listTableOf(ITEMS, 100)
    expect(table.idCells).toBe(4)
    expect(table.statusCells).toBe(cellWidthOf('◐ CI pending'))
    expect(table.rows.map((one) => one.status)).toEqual([
      '◐ CI pending',
      '✗ CI failed',
      '✓ Approved'
    ])
    expect(table.rows[2]?.title).toBe('feat(env): orca environment placement set')
  })

  it('cuts a title at a word with an ellipsis on a phone, never mid-word', () => {
    const table = listTableOf(ITEMS, 40)
    const titles = table.rows.map((one) => one.title)
    expect(titles[0]).toBe('feat(game): Panel…')
    for (const title of titles) {
      expect(cellWidthOf(title)).toBeLessThanOrEqual(40 - table.idCells - table.statusCells - 2)
      expect(title.endsWith('…') ? title.at(-2) : ' ').not.toBe(' ')
    }
  })

  it('leaves the status column out when no item has one, and room for a run mark', () => {
    const plain = listTableOf([{ id: 'ORCA-1', title: 'one two three', url: 'u' }], 40)
    expect(plain.statusCells).toBe(0)
    expect(plain.rows[0]?.status).toBe('')
    const runnable = listTableOf(
      [{ id: 'ORCA-1', title: 'a b c d e f g h i j k l m n', url: 'u', prompt: 'go' }],
      24
    )
    expect(cellWidthOf(runnable.rows[0]!.title)).toBeLessThanOrEqual(24 - 2 - 6 - 1)
  })
})
