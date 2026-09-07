import type { PlaneWorkItemPriority } from '../../../src/shared/plane-types'
import type { PlaneMobileMember, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { PlaneWorkItemPatch } from './plane-work-item-update'

/** Keyed like the work item so an override spreads straight onto the card. */
export type PlaneBoardEdit = {
  title?: string
  description?: string
  priority?: PlaneWorkItemPriority
  /** `null` clears the date. */
  startDate?: string | null
  targetDate?: string | null
  labelIds?: string[]
  assignees?: PlaneMobileMember[]
}

type EditField = keyof PlaneBoardEdit
type EditValue = PlaneBoardEdit[EditField]

const EDIT_FIELDS: readonly EditField[] = [
  'title',
  'description',
  'priority',
  'startDate',
  'targetDate',
  'labelIds',
  'assignees'
]

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
  for (const field of EDIT_FIELDS) {
    if (
      failed[field] !== undefined &&
      current[field] !== undefined &&
      sameFieldValue(current[field], failed[field])
    ) {
      replaceField(restored, field, previous?.[field])
      touched = true
    }
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

function replaceField<K extends EditField>(
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

function entryKey(entry: string | PlaneMobileMember): string {
  return typeof entry === 'string' ? entry : entry.id
}

/** Lists compare as sets (Plane returns them in its own order); a cleared date
 *  matches a read that omits the field. */
function sameFieldValue(left: EditValue, right: EditValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    const entries: readonly (string | PlaneMobileMember)[] = left
    const keys = new Set(right.map(entryKey))
    return entries.length === keys.size && entries.every((entry) => keys.has(entryKey(entry)))
  }
  return (left ?? null) === (right ?? null)
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
    for (const field of EDIT_FIELDS) {
      const value = edit[field]
      if (value !== undefined && !sameFieldValue(value, item[field])) {
        replaceField(remaining, field, value)
      }
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

/** Forgets the description override of every confirmed id the read returned. */
export function dropConfirmedDescriptions(
  overrides: PlaneBoardEditOverrides,
  items: readonly PlaneMobileWorkItem[],
  confirmed: Set<string>
): PlaneBoardEditOverrides {
  let next = overrides
  for (const { id } of items) {
    const description = next[id]?.description
    if (confirmed.delete(id) && description !== undefined) {
      next = rollbackPlaneBoardEdit(next, id, { description }, undefined)
    }
  }
  return next
}

export function toPlaneWorkItemPatch({ assignees, ...fields }: PlaneBoardEdit): PlaneWorkItemPatch {
  return assignees === undefined
    ? fields
    : { ...fields, assigneeIds: assignees.map((member) => member.id) }
}
