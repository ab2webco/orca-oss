import { describe, expect, it } from 'vitest'
import {
  buildPlaneBoardColumns,
  countPlaneBoardItems,
  findPlaneBoardColumnIndex
} from './plane-board-columns'
import { decodePlaneStates, decodePlaneWorkItems } from '../tasks/plane-mobile-work-item-read'

const states = decodePlaneStates([
  { id: 's-done', name: 'Done', group: 'completed', sequence: 30 },
  { id: 's-todo', name: 'Todo', group: 'unstarted', sequence: 10 },
  { id: 's-doing', name: 'In Progress', group: 'started', sequence: 20 }
])

function card(id: string, stateId: string, overrides: Record<string, unknown> = {}) {
  const state = states.find((entry) => entry.id === stateId) ?? {
    id: stateId,
    name: stateId,
    group: 'unknown'
  }
  return decodePlaneWorkItems([
    {
      id,
      identifier: id.toUpperCase(),
      title: `Card ${id}`,
      url: `https://plane.example/${id}`,
      project: { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
      state,
      priority: 'medium',
      updatedAt: '2026-09-04T00:00:00.000Z',
      ...overrides
    }
  ])[0]!
}

describe('plane board columns', () => {
  it('orders columns by state sequence, not by the order the host listed them', () => {
    const columns = buildPlaneBoardColumns(states, [])
    expect(columns.map((column) => column.name)).toEqual(['Todo', 'In Progress', 'Done'])
  })

  it('groups a card into the column whose state id it carries', () => {
    const columns = buildPlaneBoardColumns(states, [
      card('a', 's-doing'),
      card('b', 's-todo'),
      card('c', 's-doing')
    ])
    // The discriminating assertion: grouping keyed on state id, per column.
    expect(columns.map((column) => [column.name, column.items.map((item) => item.id)])).toEqual([
      ['Todo', ['b']],
      ['In Progress', ['a', 'c']],
      ['Done', []]
    ])
  })

  it('breaks a sequence tie on the state name', () => {
    const tied = decodePlaneStates([
      { id: 's-b', name: 'Beta', group: 'started', sequence: 10 },
      { id: 's-a', name: 'Alpha', group: 'started', sequence: 10 }
    ])
    expect(buildPlaneBoardColumns(tied, []).map((column) => column.name)).toEqual(['Alpha', 'Beta'])
  })

  it('gives a card whose state the project never listed its own trailing column', () => {
    const columns = buildPlaneBoardColumns(states, [card('a', 's-todo'), card('x', 's-ghost')])
    expect(columns.map((column) => column.name)).toEqual([
      'Todo',
      'In Progress',
      'Done',
      's-ghost'
    ])
    expect(columns.at(-1)).toMatchObject({ derived: true })
    expect(columns.at(-1)?.items.map((item) => item.id)).toEqual(['x'])
  })

  it('never appends a derived column ahead of the project columns', () => {
    // A ghost state with a low sequence must not reshuffle the real board.
    const ghost = { id: 's-ghost', name: 'Ghost', group: 'started', sequence: 1 }
    const columns = buildPlaneBoardColumns(states, [
      card('x', 's-ghost', { state: ghost }),
      card('a', 's-todo')
    ])
    expect(columns.map((column) => column.name)).toEqual(['Todo', 'In Progress', 'Done', 'Ghost'])
  })

  it('builds the whole board from the cards when the project reports no states', () => {
    const columns = buildPlaneBoardColumns([], [card('a', 's-todo'), card('b', 's-doing')])
    expect(columns.map((column) => column.name).sort()).toEqual(['In Progress', 'Todo'])
    expect(countPlaneBoardItems(columns)).toBe(2)
  })

  it('orders cards inside a column by priority then recency', () => {
    const columns = buildPlaneBoardColumns(states, [
      card('low', 's-todo', { priority: 'low', updatedAt: '2026-09-04T00:00:00.000Z' }),
      card('urgent', 's-todo', { priority: 'urgent', updatedAt: '2026-09-01T00:00:00.000Z' }),
      card('medium', 's-todo', { priority: 'medium', updatedAt: '2026-09-03T00:00:00.000Z' })
    ])
    expect(columns[0]?.items.map((item) => item.id)).toEqual(['urgent', 'medium', 'low'])
  })

  it('drops no card when every state is unknown', () => {
    const columns = buildPlaneBoardColumns([], [card('a', 's-x'), card('b', 's-y')])
    expect(countPlaneBoardItems(columns)).toBe(2)
  })

  it('falls back to the first column when the remembered one is gone', () => {
    const columns = buildPlaneBoardColumns(states, [])
    expect(findPlaneBoardColumnIndex(columns, 's-doing')).toBe(1)
    expect(findPlaneBoardColumnIndex(columns, 's-deleted')).toBe(0)
    expect(findPlaneBoardColumnIndex(columns, null)).toBe(0)
  })
})
