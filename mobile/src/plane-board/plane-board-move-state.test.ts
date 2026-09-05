import { describe, expect, it } from 'vitest'
import {
  applyPlaneBoardMoves,
  EMPTY_PLANE_BOARD_MOVES,
  reconcilePlaneBoardMoves,
  withPlaneBoardMove,
  withoutPlaneBoardMove
} from './plane-board-move-state'
import { decodePlaneStates, decodePlaneWorkItems } from '../tasks/plane-mobile-work-item-read'

const states = decodePlaneStates([
  { id: 's-todo', name: 'Todo', group: 'unstarted', sequence: 10 },
  { id: 's-done', name: 'Done', group: 'completed', sequence: 20 }
])

const items = decodePlaneWorkItems([
  {
    id: 'wi-1',
    identifier: 'ORCA-1',
    title: 'One',
    url: 'https://plane.example/wi-1',
    project: { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
    state: { id: 's-todo', name: 'Todo', group: 'unstarted' },
    priority: 'medium',
    updatedAt: '2026-09-04T00:00:00.000Z'
  }
])

describe('plane board move state', () => {
  it('shows the card in its target column before the server confirms', () => {
    const overrides = withPlaneBoardMove(EMPTY_PLANE_BOARD_MOVES, 'wi-1', 's-done')
    const moved = applyPlaneBoardMoves(items, overrides, states)
    expect(moved[0]?.state).toMatchObject({ id: 's-done', name: 'Done', group: 'completed' })
  })

  it('puts the card back when the move is reverted', () => {
    const overrides = withoutPlaneBoardMove(
      withPlaneBoardMove(EMPTY_PLANE_BOARD_MOVES, 'wi-1', 's-done'),
      'wi-1'
    )
    expect(applyPlaneBoardMoves(items, overrides, states)[0]?.state.id).toBe('s-todo')
  })

  it('leaves a card alone when the target state is not a column this client knows', () => {
    const overrides = withPlaneBoardMove(EMPTY_PLANE_BOARD_MOVES, 'wi-1', 's-ghost')
    expect(applyPlaneBoardMoves(items, overrides, states)[0]?.state.id).toBe('s-todo')
  })

  it('drops an override a fresh read already reflects', () => {
    const overrides = withPlaneBoardMove(EMPTY_PLANE_BOARD_MOVES, 'wi-1', 's-done')
    const confirmed = decodePlaneWorkItems([
      { ...items[0], state: { id: 's-done', name: 'Done', group: 'completed' } }
    ])
    expect(reconcilePlaneBoardMoves(overrides, confirmed)).toEqual({})
  })

  it('keeps an override a stale read contradicts, so the move is not clobbered', () => {
    // Why: a list fetch started before the write returns the pre-move snapshot.
    const overrides = withPlaneBoardMove(EMPTY_PLANE_BOARD_MOVES, 'wi-1', 's-done')
    expect(reconcilePlaneBoardMoves(overrides, items)).toEqual({ 'wi-1': 's-done' })
  })

  it('keeps an override for a card the read no longer returns', () => {
    const overrides = withPlaneBoardMove(EMPTY_PLANE_BOARD_MOVES, 'wi-1', 's-done')
    expect(reconcilePlaneBoardMoves(overrides, [])).toEqual({ 'wi-1': 's-done' })
  })

  it('returns the same object when nothing changes', () => {
    expect(reconcilePlaneBoardMoves(EMPTY_PLANE_BOARD_MOVES, items)).toBe(EMPTY_PLANE_BOARD_MOVES)
    expect(withoutPlaneBoardMove(EMPTY_PLANE_BOARD_MOVES, 'wi-1')).toBe(EMPTY_PLANE_BOARD_MOVES)
  })
})
