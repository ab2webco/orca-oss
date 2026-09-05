import type { PlaneMobileState, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'

/** work item id → the state it was moved to but the server has not confirmed. */
export type PlaneBoardMoveOverrides = Readonly<Record<string, string>>

export const EMPTY_PLANE_BOARD_MOVES: PlaneBoardMoveOverrides = {}

export function withPlaneBoardMove(
  overrides: PlaneBoardMoveOverrides,
  workItemId: string,
  stateId: string
): PlaneBoardMoveOverrides {
  return { ...overrides, [workItemId]: stateId }
}

export function withoutPlaneBoardMove(
  overrides: PlaneBoardMoveOverrides,
  workItemId: string
): PlaneBoardMoveOverrides {
  if (!(workItemId in overrides)) {
    return overrides
  }
  const next = { ...overrides }
  delete next[workItemId]
  return next
}

export function applyPlaneBoardMoves(
  items: readonly PlaneMobileWorkItem[],
  overrides: PlaneBoardMoveOverrides,
  states: readonly PlaneMobileState[]
): PlaneMobileWorkItem[] {
  if (Object.keys(overrides).length === 0) {
    return [...items]
  }
  const stateById = new Map(states.map((state) => [state.id, state]))
  return items.map((item) => {
    const stateId = overrides[item.id]
    if (!stateId || stateId === item.state.id) {
      return item
    }
    const target = stateById.get(stateId)
    // Why keep the card put: a target this client cannot name would render a
    // card into a column that does not exist.
    return target ? { ...item, state: { ...item.state, ...target } } : item
  })
}

/** Drops the overrides a fresh read already reflects. Without this a card that
 *  the server moved back would stay pinned to the optimistic column forever. */
export function reconcilePlaneBoardMoves(
  overrides: PlaneBoardMoveOverrides,
  items: readonly PlaneMobileWorkItem[]
): PlaneBoardMoveOverrides {
  const entries = Object.entries(overrides)
  if (entries.length === 0) {
    return overrides
  }
  const stateByItemId = new Map(items.map((item) => [item.id, item.state.id]))
  const kept = entries.filter(([workItemId, stateId]) => {
    const serverStateId = stateByItemId.get(workItemId)
    // An item the read no longer returns keeps its override: the list may be
    // filtered rather than the move undone.
    return serverStateId === undefined || serverStateId !== stateId
  })
  return kept.length === entries.length ? overrides : Object.fromEntries(kept)
}
