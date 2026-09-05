import { describe, expect, it } from 'vitest'
import {
  resolvePlaneBoardEmptyState,
  type PlaneBoardEmptyStateInput
} from './plane-board-empty-state'
import type { PlaneBoardColumn } from './plane-board-columns'

function column(name: string, itemCount: number): PlaneBoardColumn {
  return {
    stateId: `s-${name}`,
    name,
    group: 'started',
    derived: false,
    items: Array.from({ length: itemCount }, () => ({}) as PlaneBoardColumn['items'][number])
  }
}

function input(overrides: Partial<PlaneBoardEmptyStateInput> = {}): PlaneBoardEmptyStateInput {
  const columns = [column('Todo', 1), column('Done', 0)]
  return {
    planeConnected: true,
    projectId: 'p1',
    projectName: 'Orca Lab',
    columns,
    activeColumn: columns[0]!,
    filtered: false,
    unfilteredCount: 1,
    ...overrides
  }
}

describe('plane board empty state', () => {
  it('says nothing when the active column has cards', () => {
    expect(resolvePlaneBoardEmptyState(input())).toBeNull()
  })

  it('distinguishes all five causes by kind, title and action', () => {
    const cases: [string, PlaneBoardEmptyStateInput][] = [
      ['disconnected', input({ planeConnected: false })],
      ['no-project', input({ projectId: null })],
      ['board-empty', input({ columns: [], activeColumn: null })],
      ['filter-empty', input({ filtered: true, unfilteredCount: 4, activeColumn: column('T', 0) })],
      ['column-empty', input({ activeColumn: column('Done', 0) })]
    ]
    const resolved = cases.map(([, value]) => resolvePlaneBoardEmptyState(value))

    expect(resolved.map((state) => state?.kind)).toEqual(cases.map(([kind]) => kind))
    // The discriminating half: one text for several causes is the defect this
    // guards against, so every title and body must be distinct.
    expect(new Set(resolved.map((state) => state?.title)).size).toBe(5)
    expect(new Set(resolved.map((state) => state?.body)).size).toBe(5)
  })

  it('names the project that has no work items yet', () => {
    const state = resolvePlaneBoardEmptyState(
      input({ unfilteredCount: 0, activeColumn: column('Todo', 0) })
    )
    expect(state).toMatchObject({ kind: 'board-empty', action: 'refresh' })
    expect(state?.title).toContain('Orca Lab')
  })

  it('counts what the filter is hiding rather than saying no items', () => {
    const state = resolvePlaneBoardEmptyState(
      input({ filtered: true, unfilteredCount: 4, activeColumn: column('Todo', 0) })
    )
    expect(state).toMatchObject({ kind: 'filter-empty', action: 'clear-filter' })
    expect(state?.body).toContain('4 cards')
  })

  it('singularises the hidden-card count', () => {
    const state = resolvePlaneBoardEmptyState(
      input({ filtered: true, unfilteredCount: 1, activeColumn: column('Todo', 0) })
    )
    expect(state?.body).toContain('1 card in this project is hidden')
  })

  it('offers no action for an empty column, because there is nothing to press', () => {
    expect(resolvePlaneBoardEmptyState(input({ activeColumn: column('Done', 0) }))).toMatchObject({
      kind: 'column-empty',
      action: null,
      actionLabel: null
    })
  })

  it('reports the disconnected host before anything else it cannot know', () => {
    expect(
      resolvePlaneBoardEmptyState(
        input({ planeConnected: false, projectId: null, columns: [], activeColumn: null })
      )
    ).toMatchObject({ kind: 'disconnected' })
  })
})
