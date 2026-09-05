import type { PlaneWorkItemPriority } from '../../../src/shared/plane-types'
import type { PlaneMobileMember, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { PlaneWorkItemPatch } from './plane-work-item-update'

export type PlaneBoardEdit = {
  priority?: PlaneWorkItemPriority
  assignees?: PlaneMobileMember[]
}

/** work item id → the fields the phone changed but the server has not confirmed. */
export type PlaneBoardEditOverrides = Readonly<Record<string, PlaneBoardEdit>>

export const EMPTY_PLANE_BOARD_EDITS: PlaneBoardEditOverrides = {}

export function withPlaneBoardEdit(
  overrides: PlaneBoardEditOverrides,
  workItemId: string,
  edit: PlaneBoardEdit
): PlaneBoardEditOverrides {
  return { ...overrides, [workItemId]: { ...overrides[workItemId], ...edit } }
}

/** Undoes a refused edit field by field: a field the card still shows at the
 *  refused value goes back to what it showed before; one a later write on the
 *  same card changed since is that write's to keep or roll back. */
export function rollbackPlaneBoardEdit(
  overrides: PlaneBoardEditOverrides,
  workItemId: string,
  failed: PlaneBoardEdit,
  previous: PlaneBoardEdit | undefined
): PlaneBoardEditOverrides {
  const current = overrides[workItemId]
  if (!current) {
    return overrides
  }
  const restored: PlaneBoardEdit = { ...current }
  let touched = false
  if (failed.priority !== undefined && current.priority === failed.priority) {
    replaceField(restored, 'priority', previous?.priority)
    touched = true
  }
  if (
    failed.assignees !== undefined &&
    current.assignees !== undefined &&
    sameAssignees(current.assignees, failed.assignees)
  ) {
    replaceField(restored, 'assignees', previous?.assignees)
    touched = true
  }
  if (!touched) {
    return overrides
  }
  const next = { ...overrides }
  if (Object.keys(restored).length > 0) {
    next[workItemId] = restored
  } else {
    delete next[workItemId]
  }
  return next
}

function replaceField<K extends keyof PlaneBoardEdit>(
  edit: PlaneBoardEdit,
  field: K,
  value: PlaneBoardEdit[K] | undefined
): void {
  if (value === undefined) {
    delete edit[field]
  } else {
    edit[field] = value
  }
}

export function applyPlaneBoardEdits(
  items: readonly PlaneMobileWorkItem[],
  overrides: PlaneBoardEditOverrides
): PlaneMobileWorkItem[] {
  if (Object.keys(overrides).length === 0) {
    return [...items]
  }
  return items.map((item) => {
    const edit = overrides[item.id]
    return edit ? { ...item, ...edit } : item
  })
}

function sameAssignees(
  left: readonly PlaneMobileMember[],
  right: readonly PlaneMobileMember[]
): boolean {
  if (left.length !== right.length) {
    return false
  }
  const ids = new Set(right.map((member) => member.id))
  return left.every((member) => ids.has(member.id))
}

/** Drops the fields a fresh read already reflects. Without this a value the
 *  server changed back would stay pinned to the optimistic one forever. */
export function reconcilePlaneBoardEdits(
  overrides: PlaneBoardEditOverrides,
  items: readonly PlaneMobileWorkItem[]
): PlaneBoardEditOverrides {
  const entries = Object.entries(overrides)
  if (entries.length === 0) {
    return overrides
  }
  const itemById = new Map(items.map((item) => [item.id, item]))
  let changed = false
  const kept: Record<string, PlaneBoardEdit> = {}
  for (const [workItemId, edit] of entries) {
    const item = itemById.get(workItemId)
    // An item the read no longer returns keeps its override: the list may be
    // filtered rather than the edit undone.
    if (!item) {
      kept[workItemId] = edit
      continue
    }
    const remaining: PlaneBoardEdit = {}
    if (edit.priority !== undefined && edit.priority !== item.priority) {
      remaining.priority = edit.priority
    }
    if (edit.assignees !== undefined && !sameAssignees(edit.assignees, item.assignees)) {
      remaining.assignees = edit.assignees
    }
    if (Object.keys(remaining).length === Object.keys(edit).length) {
      kept[workItemId] = edit
      continue
    }
    changed = true
    if (Object.keys(remaining).length > 0) {
      kept[workItemId] = remaining
    }
  }
  return changed ? kept : overrides
}

export function toPlaneWorkItemPatch(edit: PlaneBoardEdit): PlaneWorkItemPatch {
  const patch: PlaneWorkItemPatch = {}
  if (edit.priority !== undefined) {
    patch.priority = edit.priority
  }
  if (edit.assignees !== undefined) {
    patch.assigneeIds = edit.assignees.map((member) => member.id)
  }
  return patch
}
