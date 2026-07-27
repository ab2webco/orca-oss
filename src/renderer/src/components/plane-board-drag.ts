// Pure drag/state-change logic for the Plane Kanban board. Kept free of React
// and dnd-kit so the optimistic-move + update-payload + revert reducer stays
// unit-testable (see plane-board-drag.test.ts).
import type { PlaneState, PlaneWorkItem } from '../../../shared/plane-types'

export type PlaneBoardColumn = {
  stateId: string
  state: PlaneState
  items: PlaneWorkItem[]
}

// Optimistic layer: work item id -> state id the user just dropped it into,
// held until an incoming refresh reflects the change (see reconcile helper).
export type PlaneBoardStateOverrides = Readonly<Record<string, string>>

export type PlaneBoardStateUpdate = {
  projectId: string
  workItemId: string
  workspaceId: string | null
  stateId: string
}

export type PlaneBoardDropPlan = {
  workItem: PlaneWorkItem
  previousStateId: string
  targetState: PlaneState
  update: PlaneBoardStateUpdate
}

// dnd-kit droppable id for a column; cards use their bare work item id.
const COLUMN_DROPPABLE_PREFIX = 'plane-board-column:'

export function planeBoardColumnDroppableId(stateId: string): string {
  return `${COLUMN_DROPPABLE_PREFIX}${stateId}`
}

export function parsePlaneBoardColumnDroppableId(droppableId: string): string | null {
  return droppableId.startsWith(COLUMN_DROPPABLE_PREFIX)
    ? droppableId.slice(COLUMN_DROPPABLE_PREFIX.length)
    : null
}

function comparePlaneStatesBySequence(a: PlaneState, b: PlaneState): number {
  const rankA = a.sequence ?? Number.POSITIVE_INFINITY
  const rankB = b.sequence ?? Number.POSITIVE_INFINITY
  return rankA === rankB ? a.name.localeCompare(b.name) : rankA - rankB
}

function groupWorkItemsByStateId(items: readonly PlaneWorkItem[]): Map<string, PlaneWorkItem[]> {
  const grouped = new Map<string, PlaneWorkItem[]>()
  for (const item of items) {
    const existing = grouped.get(item.state.id)
    if (existing) {
      existing.push(item)
    } else {
      grouped.set(item.state.id, [item])
    }
  }
  return grouped
}

// Fallback column source when the full project state list isn't available:
// the distinct states carried on the loaded work items themselves.
function derivePlaneStatesFromItems(items: readonly PlaneWorkItem[]): PlaneState[] {
  const byId = new Map<string, PlaneState>()
  for (const item of items) {
    if (!byId.has(item.state.id)) {
      byId.set(item.state.id, item.state)
    }
  }
  return [...byId.values()]
}

// Build columns from the project's real states (so empty columns still show),
// appending any item-only states missing from that list. Falls back to the
// item-derived states when projectStates is empty.
export function resolvePlaneBoardColumns(
  items: readonly PlaneWorkItem[],
  projectStates: readonly PlaneState[]
): PlaneBoardColumn[] {
  const itemsByStateId = groupWorkItemsByStateId(items)
  const seen = new Set<string>()
  const columns: PlaneBoardColumn[] = []
  const push = (state: PlaneState): void => {
    if (seen.has(state.id)) {
      return
    }
    seen.add(state.id)
    columns.push({ stateId: state.id, state, items: itemsByStateId.get(state.id) ?? [] })
  }
  for (const state of [...projectStates].sort(comparePlaneStatesBySequence)) {
    push(state)
  }
  for (const state of derivePlaneStatesFromItems(items).sort(comparePlaneStatesBySequence)) {
    push(state)
  }
  return columns
}

export function planeBoardStatesById(
  columns: readonly PlaneBoardColumn[]
): Map<string, PlaneState> {
  return new Map(columns.map((column) => [column.stateId, column.state]))
}

// dnd-kit draggable data discriminators. Cards move an item to a state; columns
// reorder the board. handleDragEnd branches on this so both drags coexist.
export type PlaneBoardCardDragData = { type: 'card'; stateId: string }
export type PlaneBoardColumnDragData = { type: 'column'; stateId: string }

// Read the discriminator off dnd-kit's untyped `data.current` without `any`.
export function readPlaneBoardDragType(data: unknown): 'card' | 'column' | null {
  if (data && typeof data === 'object' && 'type' in data) {
    const value = (data as { type?: unknown }).type
    if (value === 'card' || value === 'column') {
      return value
    }
  }
  return null
}

// Both the card droppable and the column sortable carry `stateId`, so a card
// drop resolves the target state regardless of which droppable dnd-kit picks.
export function readPlaneBoardDragStateId(data: unknown): string | null {
  if (data && typeof data === 'object' && 'stateId' in data) {
    const value = (data as { stateId?: unknown }).stateId
    return typeof value === 'string' ? value : null
  }
  return null
}

// A single column's new authoritative order, as the PATCH payload a reorder
// sends to Plane (`sequence` is Plane's source of truth for column order).
export type PlaneBoardSequenceUpdate = { stateId: string; sequence: number }

const COLUMN_SEQUENCE_STEP = 1000

function sequenceForReorderIndex(index: number): number {
  return (index + 1) * COLUMN_SEQUENCE_STEP
}

// Map a reordered stateId list to per-state `sequence` PATCH payloads. Sequences
// are spaced by 1000 so a later single-column insert between two columns has room
// without renumbering the whole board. Only states whose sequence actually
// changes are returned, so a no-op reorder issues no requests.
export function planPlaneBoardColumnReorder(
  orderedStateIds: readonly string[],
  currentSequenceByStateId: ReadonlyMap<string, number | undefined>
): PlaneBoardSequenceUpdate[] {
  const updates: PlaneBoardSequenceUpdate[] = []
  orderedStateIds.forEach((stateId, index) => {
    const sequence = sequenceForReorderIndex(index)
    if (currentSequenceByStateId.get(stateId) !== sequence) {
      updates.push({ stateId, sequence })
    }
  })
  return updates
}

export function planPlaneBoardColumnInsertion(
  orderedStateIds: readonly string[],
  currentSequenceByStateId: ReadonlyMap<string, number | undefined>,
  insertionIndex: number
): number {
  const index = Math.max(0, Math.min(insertionIndex, orderedStateIds.length))
  const leftId = orderedStateIds[index - 1]
  const rightId = orderedStateIds[index]
  const left =
    leftId === undefined
      ? undefined
      : (currentSequenceByStateId.get(leftId) ?? sequenceForReorderIndex(index - 1))
  const right =
    rightId === undefined
      ? undefined
      : (currentSequenceByStateId.get(rightId) ?? sequenceForReorderIndex(index))

  if (left !== undefined && right !== undefined) {
    return left + (right - left) / 2
  }
  if (left !== undefined) {
    return left + COLUMN_SEQUENCE_STEP
  }
  if (right !== undefined) {
    return right > 0 ? right / 2 : right - COLUMN_SEQUENCE_STEP
  }
  return COLUMN_SEQUENCE_STEP
}

function findWorkItem(
  columns: readonly PlaneBoardColumn[],
  workItemId: string
): PlaneWorkItem | null {
  for (const column of columns) {
    const match = column.items.find((item) => item.id === workItemId)
    if (match) {
      return match
    }
  }
  return null
}

// Plan a drop: null when it's a no-op (same column, unknown card, or unknown
// target). Otherwise returns the optimistic target state plus the exact update
// payload the detail state-picker uses ({ stateId }).
export function planPlaneBoardDrop(args: {
  columns: readonly PlaneBoardColumn[]
  activeWorkItemId: string
  targetStateId: string | null
}): PlaneBoardDropPlan | null {
  const { columns, activeWorkItemId, targetStateId } = args
  if (!targetStateId) {
    return null
  }
  const workItem = findWorkItem(columns, activeWorkItemId)
  if (!workItem || workItem.state.id === targetStateId) {
    return null
  }
  const targetColumn = columns.find((column) => column.stateId === targetStateId)
  if (!targetColumn) {
    return null
  }
  return {
    workItem,
    previousStateId: workItem.state.id,
    targetState: targetColumn.state,
    update: {
      projectId: workItem.project.id,
      workItemId: workItem.id,
      workspaceId: workItem.workspaceId ?? null,
      stateId: targetStateId
    }
  }
}

export function withPlaneBoardStateOverride(
  overrides: PlaneBoardStateOverrides,
  workItemId: string,
  stateId: string
): PlaneBoardStateOverrides {
  return { ...overrides, [workItemId]: stateId }
}

export function withoutPlaneBoardStateOverride(
  overrides: PlaneBoardStateOverrides,
  workItemId: string
): PlaneBoardStateOverrides {
  if (!(workItemId in overrides)) {
    return overrides
  }
  const next = { ...overrides }
  delete next[workItemId]
  return next
}

// Apply the optimistic overrides on top of the source items, swapping each
// overridden item's state for the resolved target state.
export function applyPlaneBoardStateOverrides(
  items: readonly PlaneWorkItem[],
  overrides: PlaneBoardStateOverrides,
  statesById: ReadonlyMap<string, PlaneState>
): PlaneWorkItem[] {
  if (Object.keys(overrides).length === 0) {
    return [...items]
  }
  return items.map((item) => {
    const overrideStateId = overrides[item.id]
    if (!overrideStateId || overrideStateId === item.state.id) {
      return item
    }
    const nextState = statesById.get(overrideStateId)
    return nextState ? { ...item, state: nextState } : item
  })
}

// Drop overrides once the incoming items already reflect them (a refresh
// reconciled the change) or the item disappeared from the list.
export function reconcilePlaneBoardOverrides(
  overrides: PlaneBoardStateOverrides,
  items: readonly PlaneWorkItem[]
): PlaneBoardStateOverrides {
  const keys = Object.keys(overrides)
  if (keys.length === 0) {
    return overrides
  }
  const itemsById = new Map(items.map((item) => [item.id, item]))
  let changed = false
  const next = { ...overrides }
  for (const workItemId of keys) {
    const item = itemsById.get(workItemId)
    if (!item || item.state.id === overrides[workItemId]) {
      delete next[workItemId]
      changed = true
    }
  }
  return changed ? next : overrides
}
