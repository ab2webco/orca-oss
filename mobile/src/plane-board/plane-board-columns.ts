import type { PlaneMobileState, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { sortPlaneWorkItems } from '../tasks/plane-mobile-task-list'

export type PlaneBoardColumn = {
  stateId: string
  name: string
  group: string
  items: PlaneMobileWorkItem[]
  /** True when the column came from the cards rather than from plane.listStates. */
  derived: boolean
}

function compareStatesBySequence(a: PlaneMobileState, b: PlaneMobileState): number {
  const rankA = a.sequence ?? Number.POSITIVE_INFINITY
  const rankB = b.sequence ?? Number.POSITIVE_INFINITY
  return rankA === rankB ? a.name.localeCompare(b.name) : rankA - rankB
}

/** States a card claims that plane.listStates did not report — a project whose
 *  columns changed, or a host newer than this client. They become real columns
 *  instead of hiding the cards that sit in them. */
function derivePlaneStatesFromItems(
  items: readonly PlaneMobileWorkItem[],
  known: ReadonlySet<string>
): PlaneMobileState[] {
  const derived = new Map<string, PlaneMobileState>()
  for (const item of items) {
    const { id, name, group } = item.state
    if (!id || known.has(id) || derived.has(id)) {
      continue
    }
    derived.set(id, { id, name: name || group || id, group })
  }
  return [...derived.values()]
}

export function buildPlaneBoardColumns(
  states: readonly PlaneMobileState[],
  items: readonly PlaneMobileWorkItem[]
): PlaneBoardColumn[] {
  // Sorting once up front: grouping below is stable, so each column inherits
  // this order (inside one column the state term is constant, leaving
  // priority then recency).
  const ordered = sortPlaneWorkItems(items, states)
  const byStateId = new Map<string, PlaneMobileWorkItem[]>()
  for (const item of ordered) {
    const bucket = byStateId.get(item.state.id)
    if (bucket) {
      bucket.push(item)
    } else {
      byStateId.set(item.state.id, [item])
    }
  }

  const known = new Set(states.map((state) => state.id).filter(Boolean))
  const columns: PlaneBoardColumn[] = []
  const seen = new Set<string>()
  const push = (state: PlaneMobileState, derived: boolean): void => {
    if (!state.id || seen.has(state.id)) {
      return
    }
    seen.add(state.id)
    columns.push({
      stateId: state.id,
      name: state.name || state.group || state.id,
      group: state.group,
      items: byStateId.get(state.id) ?? [],
      derived
    })
  }

  // Project columns keep their board order; derived ones are appended, never
  // interleaved, so an unknown sequence cannot reshuffle the real board.
  for (const state of [...states].sort(compareStatesBySequence)) {
    push(state, false)
  }
  for (const state of derivePlaneStatesFromItems(items, known).sort(compareStatesBySequence)) {
    push(state, true)
  }
  return columns
}

export function countPlaneBoardItems(columns: readonly PlaneBoardColumn[]): number {
  return columns.reduce((total, column) => total + column.items.length, 0)
}

export function findPlaneBoardColumnIndex(
  columns: readonly PlaneBoardColumn[],
  stateId: string | null
): number {
  const index = columns.findIndex((column) => column.stateId === stateId)
  return index === -1 ? 0 : index
}
