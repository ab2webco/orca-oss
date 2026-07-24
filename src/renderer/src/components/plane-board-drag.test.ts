import { describe, expect, it } from 'vitest'
import type { PlaneState, PlaneWorkItem } from '../../../shared/plane-types'
import {
  applyPlaneBoardStateOverrides,
  orderPlaneBoardColumns,
  parsePlaneBoardColumnDroppableId,
  planPlaneBoardDrop,
  planeBoardColumnDroppableId,
  planeBoardStatesById,
  reconcilePlaneBoardOverrides,
  resolvePlaneBoardColumns,
  withPlaneBoardStateOverride,
  withoutPlaneBoardStateOverride
} from './plane-board-drag'

const TODO: PlaneState = { id: 'state-todo', name: 'Todo', group: 'unstarted', sequence: 1 }
const DOING: PlaneState = { id: 'state-doing', name: 'In Progress', group: 'started', sequence: 2 }
const DONE: PlaneState = { id: 'state-done', name: 'Done', group: 'completed', sequence: 3 }

function workItem(id: string, state: PlaneState): PlaneWorkItem {
  return {
    id,
    identifier: `PROJ-${id}`,
    sequenceId: Number(id) || 0,
    workspaceId: 'ws-1',
    title: `Item ${id}`,
    url: `https://plane.example/${id}`,
    project: { id: 'proj-1', identifier: 'PROJ', name: 'Project' },
    state,
    labels: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('resolvePlaneBoardColumns', () => {
  it('orders columns by sequence and keeps empty project states', () => {
    const items = [workItem('1', TODO), workItem('2', DONE)]
    const columns = resolvePlaneBoardColumns(items, [DONE, TODO, DOING])
    expect(columns.map((column) => column.stateId)).toEqual([
      'state-todo',
      'state-doing',
      'state-done'
    ])
    expect(columns[1].items).toHaveLength(0)
    expect(columns[0].items.map((item) => item.id)).toEqual(['1'])
  })

  it('falls back to item-derived states when the project list is empty', () => {
    const items = [workItem('1', DOING), workItem('2', TODO)]
    const columns = resolvePlaneBoardColumns(items, [])
    expect(columns.map((column) => column.stateId)).toEqual(['state-todo', 'state-doing'])
  })
})

describe('planPlaneBoardDrop', () => {
  const columns = resolvePlaneBoardColumns(
    [workItem('1', TODO), workItem('2', DOING)],
    [TODO, DOING, DONE]
  )

  it('produces the optimistic target state and the { stateId } update payload for A -> B', () => {
    const plan = planPlaneBoardDrop({
      columns,
      activeWorkItemId: '1',
      targetStateId: 'state-done'
    })
    expect(plan).not.toBeNull()
    expect(plan?.previousStateId).toBe('state-todo')
    expect(plan?.targetState).toEqual(DONE)
    expect(plan?.update).toEqual({
      projectId: 'proj-1',
      workItemId: '1',
      workspaceId: 'ws-1',
      stateId: 'state-done'
    })
  })

  it('is a no-op when dropped in the same column', () => {
    expect(
      planPlaneBoardDrop({ columns, activeWorkItemId: '1', targetStateId: 'state-todo' })
    ).toBeNull()
  })

  it('is a no-op for an unknown card or missing target', () => {
    expect(
      planPlaneBoardDrop({ columns, activeWorkItemId: 'nope', targetStateId: 'state-done' })
    ).toBeNull()
    expect(planPlaneBoardDrop({ columns, activeWorkItemId: '1', targetStateId: null })).toBeNull()
  })
})

describe('optimistic overrides', () => {
  const items = [workItem('1', TODO), workItem('2', DOING)]
  const statesById = planeBoardStatesById(resolvePlaneBoardColumns(items, [TODO, DOING, DONE]))

  it('applies an override to move a card optimistically', () => {
    const overrides = withPlaneBoardStateOverride({}, '1', 'state-done')
    const moved = applyPlaneBoardStateOverrides(items, overrides, statesById)
    expect(moved.find((item) => item.id === '1')?.state).toEqual(DONE)
    // Untouched card keeps its state.
    expect(moved.find((item) => item.id === '2')?.state).toEqual(DOING)
  })

  it('reverts by removing the override (failure path)', () => {
    const overrides = withPlaneBoardStateOverride({}, '1', 'state-done')
    const reverted = withoutPlaneBoardStateOverride(overrides, '1')
    const restored = applyPlaneBoardStateOverrides(items, reverted, statesById)
    expect(restored.find((item) => item.id === '1')?.state).toEqual(TODO)
  })

  it('reconciles away overrides once the incoming items already reflect them', () => {
    const overrides = withPlaneBoardStateOverride({}, '1', 'state-done')
    const refreshed = [workItem('1', DONE), workItem('2', DOING)]
    expect(reconcilePlaneBoardOverrides(overrides, refreshed)).toEqual({})
  })

  it('keeps an override while the incoming items still show the old state', () => {
    const overrides = withPlaneBoardStateOverride({}, '1', 'state-done')
    expect(reconcilePlaneBoardOverrides(overrides, items)).toEqual(overrides)
  })
})

describe('orderPlaneBoardColumns', () => {
  // resolvePlaneBoardColumns already returns columns in sequence order.
  const sequenceColumns = resolvePlaneBoardColumns(
    [workItem('1', TODO), workItem('2', DOING), workItem('3', DONE)],
    [TODO, DOING, DONE]
  )

  it('applies the saved order first', () => {
    const ordered = orderPlaneBoardColumns(sequenceColumns, [
      'state-done',
      'state-todo',
      'state-doing'
    ])
    expect(ordered.map((column) => column.stateId)).toEqual([
      'state-done',
      'state-todo',
      'state-doing'
    ])
  })

  it('appends unknown (unsaved) states after saved ones in their sequence order', () => {
    const ordered = orderPlaneBoardColumns(sequenceColumns, ['state-done'])
    expect(ordered.map((column) => column.stateId)).toEqual([
      'state-done',
      'state-todo',
      'state-doing'
    ])
  })

  it('ignores stale saved ids that no longer map to a column', () => {
    const ordered = orderPlaneBoardColumns(sequenceColumns, ['state-gone', 'state-doing'])
    expect(ordered.map((column) => column.stateId)).toEqual([
      'state-doing',
      'state-todo',
      'state-done'
    ])
  })

  it('falls back to sequence order for empty or undefined saved order', () => {
    const bySequence = ['state-todo', 'state-doing', 'state-done']
    expect(orderPlaneBoardColumns(sequenceColumns, undefined).map((c) => c.stateId)).toEqual(
      bySequence
    )
    expect(orderPlaneBoardColumns(sequenceColumns, []).map((c) => c.stateId)).toEqual(bySequence)
  })
})

describe('column droppable id round-trip', () => {
  it('encodes and parses a state id', () => {
    expect(parsePlaneBoardColumnDroppableId(planeBoardColumnDroppableId('state-x'))).toBe('state-x')
    expect(parsePlaneBoardColumnDroppableId('state-x')).toBeNull()
  })
})
