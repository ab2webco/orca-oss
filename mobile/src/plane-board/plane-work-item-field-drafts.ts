// Pure decisions behind the detail sheet's editable fields: "should this draft
// be sent, and as what?" — testable without a React tree, as on the desktop.

/** `null` discards the draft: Plane requires a title, so an empty one is restored, not sent. */
export function resolvePlaneTitleSave(args: {
  draft: string
  stored: string
}): { title: string } | null {
  const title = args.draft.trim()
  return !title || title === args.stored ? null : { title }
}

/** An item that never had a description reads as undefined, so closing it untouched is not a change. */
export function shouldSavePlaneDescription(args: {
  draft: string
  stored: string | undefined
}): boolean {
  return args.draft !== (args.stored ?? '')
}

/** Splits the comma-separated draft into the id list; `null` when it is the set the card has. */
export function resolvePlaneLabelsSave(args: {
  draft: string
  stored: readonly string[] | undefined
}): { labelIds: string[] } | null {
  const labelIds = args.draft
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)
  const stored = new Set(args.stored ?? [])
  const unchanged = labelIds.length === stored.size && labelIds.every((id) => stored.has(id))
  return unchanged ? null : { labelIds }
}

export const PLANE_DATE_FORMAT_ERROR = 'Use the YYYY-MM-DD format'
export const PLANE_DATE_CLEAR_UNSUPPORTED_ERROR = 'This host cannot clear a date yet'

export type PlaneDateSave = { value: string | null } | { error: string } | null

/** Empty clears a stored date (`null` on the wire); unchanged is a no-op. */
export function resolvePlaneDateSave(args: {
  draft: string
  stored: string | null | undefined
  clearable: boolean
}): PlaneDateSave {
  const draft = args.draft.trim()
  const stored = args.stored ?? null
  if (!draft) {
    const clear = args.clearable ? { value: null } : { error: PLANE_DATE_CLEAR_UNSUPPORTED_ERROR }
    return stored === null ? null : clear
  }
  if (!isCalendarDate(draft)) {
    return { error: PLANE_DATE_FORMAT_ERROR }
  }
  return draft === stored ? null : { value: draft }
}

/** A shape check alone would take 2026-02-30; the round-trip is what rejects it. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
