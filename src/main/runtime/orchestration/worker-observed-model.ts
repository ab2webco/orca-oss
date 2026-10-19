/** The model and effort a member's own hooks named, as its CLI spells them. */
export type WorkerObservedModel = { model?: string; effort?: string }

const VALUE_MAX = 64

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, VALUE_MAX) : undefined

/** A stored sighting; null when it is unreadable or names neither. */
export function workerObservedModelOf(stored: string): WorkerObservedModel | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  const record = parsed as Record<string, unknown>
  const model = textOf(record.model)
  const effort = textOf(record.effort)
  if (model === undefined && effort === undefined) {
    return null
  }
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
}
