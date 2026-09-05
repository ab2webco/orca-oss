import { describe, expect, it } from 'vitest'
import { decodePlaneWorkItems } from '../tasks/plane-mobile-work-item-read'
import {
  applyPlaneBoardEdits,
  EMPTY_PLANE_BOARD_EDITS,
  reconcilePlaneBoardEdits,
  rollbackPlaneBoardEdit,
  toPlaneWorkItemPatch,
  withPlaneBoardEdit
} from './plane-board-edit-state'

const ADA = { id: 'u-1', displayName: 'Ada' }
const GRACE = { id: 'u-2', displayName: 'Grace' }

const items = decodePlaneWorkItems([
  {
    id: 'wi-1',
    identifier: 'ORCA-1',
    title: 'One',
    url: 'https://plane.example/wi-1',
    project: { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
    state: { id: 's-todo', name: 'Todo', group: 'unstarted' },
    priority: 'medium',
    assignees: [ADA],
    updatedAt: '2026-09-04T00:00:00.000Z'
  }
])

describe('plane board edit state', () => {
  it('shows the new priority on the card before the server confirms', () => {
    const edits = withPlaneBoardEdit(EMPTY_PLANE_BOARD_EDITS, 'wi-1', { priority: 'urgent' })
    expect(applyPlaneBoardEdits(items, edits)[0]).toMatchObject({
      priority: 'urgent',
      assignees: [ADA]
    })
  })

  it('shows the new assignees on the card before the server confirms', () => {
    const edits = withPlaneBoardEdit(EMPTY_PLANE_BOARD_EDITS, 'wi-1', { assignees: [ADA, GRACE] })
    expect(applyPlaneBoardEdits(items, edits)[0]).toMatchObject({
      priority: 'medium',
      assignees: [ADA, GRACE]
    })
  })

  it('keeps a confirmed priority when a later assignee edit is rolled back', () => {
    const afterPriority = withPlaneBoardEdit(EMPTY_PLANE_BOARD_EDITS, 'wi-1', { priority: 'high' })
    const during = withPlaneBoardEdit(afterPriority, 'wi-1', { assignees: [] })
    expect(applyPlaneBoardEdits(items, during)[0]).toMatchObject({
      priority: 'high',
      assignees: []
    })
    const rolledBack = rollbackPlaneBoardEdit(
      during,
      'wi-1',
      { assignees: [] },
      afterPriority['wi-1']
    )
    expect(applyPlaneBoardEdits(items, rolledBack)[0]).toMatchObject({
      priority: 'high',
      assignees: [ADA]
    })
  })

  it('puts the card back entirely when the only edit is rolled back', () => {
    const edits = withPlaneBoardEdit(EMPTY_PLANE_BOARD_EDITS, 'wi-1', { priority: 'urgent' })
    const rolledBack = rollbackPlaneBoardEdit(edits, 'wi-1', { priority: 'urgent' }, undefined)
    expect(rolledBack).toEqual({})
    expect(applyPlaneBoardEdits(items, rolledBack)[0]?.priority).toBe('medium')
  })

  it('leaves a field a later write changed alone when an earlier one is rolled back', () => {
    const first = withPlaneBoardEdit(EMPTY_PLANE_BOARD_EDITS, 'wi-1', { priority: 'high' })
    const second = withPlaneBoardEdit(first, 'wi-1', { priority: 'urgent' })
    expect(rollbackPlaneBoardEdit(second, 'wi-1', { priority: 'high' }, undefined)).toBe(second)
  })

  it('rolls a refused assignee list back to the one shown before it, by member ids', () => {
    const first = withPlaneBoardEdit(EMPTY_PLANE_BOARD_EDITS, 'wi-1', { assignees: [GRACE] })
    const second = withPlaneBoardEdit(first, 'wi-1', { assignees: [ADA, GRACE] })
    const rolledBack = rollbackPlaneBoardEdit(
      second,
      'wi-1',
      { assignees: [GRACE, ADA] },
      first['wi-1']
    )
    expect(rolledBack['wi-1']).toEqual({ assignees: [GRACE] })
  })

  it('leaves the list untouched when nothing is overridden', () => {
    expect(applyPlaneBoardEdits(items, EMPTY_PLANE_BOARD_EDITS)).toEqual(items)
  })

  it('drops the fields a fresh read already reflects and keeps the rest', () => {
    const edits = withPlaneBoardEdit(EMPTY_PLANE_BOARD_EDITS, 'wi-1', {
      priority: 'urgent',
      assignees: [GRACE]
    })
    const serverHasPriority = decodePlaneWorkItems([
      { ...items[0], priority: 'urgent', assignees: [ADA] }
    ])
    expect(reconcilePlaneBoardEdits(edits, serverHasPriority)).toEqual({
      'wi-1': { assignees: [GRACE] }
    })
    const serverHasBoth = decodePlaneWorkItems([
      { ...items[0], priority: 'urgent', assignees: [GRACE] }
    ])
    expect(reconcilePlaneBoardEdits(edits, serverHasBoth)).toEqual(EMPTY_PLANE_BOARD_EDITS)
  })

  it('keeps an override for a card the read no longer returns', () => {
    // The list may be filtered rather than the edit undone.
    const edits = withPlaneBoardEdit(EMPTY_PLANE_BOARD_EDITS, 'wi-9', { priority: 'low' })
    expect(reconcilePlaneBoardEdits(edits, items)).toBe(edits)
  })

  it('turns an edit into the ids Plane expects', () => {
    expect(toPlaneWorkItemPatch({ assignees: [ADA, GRACE] })).toEqual({
      assigneeIds: ['u-1', 'u-2']
    })
    expect(toPlaneWorkItemPatch({ priority: 'low' })).toEqual({ priority: 'low' })
  })
})
