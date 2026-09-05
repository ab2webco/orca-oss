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

/** Rolls one card back to the entry it had before the failed edit, so a field
 *  Plane already confirmed is not undone along with the one it refused. */
export function restorePlaneBoardEdit(
  overrides: PlaneBoardEditOverrides,
  workItemId: string,
  previous: PlaneBoardEdit | undefined
): PlaneBoardEditOverrides {
  const next = { ...overrides }
  if (previous) {
    next[workItemId] = previous
  } else {
    delete next[workItemId]
  }
  return next
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
