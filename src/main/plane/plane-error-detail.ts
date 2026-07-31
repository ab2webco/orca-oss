// Plane 4xx bodies are not one shape: some endpoints answer { error: "..." },
// DRF serializer rejections arrive as { name: ["..."] } or
// { non_field_errors: [...] }, and a few return a bare array of strings. Only
// the first shape used to survive, so a rejected project write surfaced as the
// bare status line ("Plane request failed (400)") and hid Plane's reason
// (ORCA-140).
const PREFERRED_KEYS = ['error', 'detail', 'message', 'non_field_errors'] as const
const MAX_NESTING = 4
const MAX_DETAIL_CHARS = 600

function flatten(value: unknown, depth: number): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }
  if (depth >= MAX_NESTING || !value || typeof value !== 'object') {
    return []
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flatten(entry, depth + 1))
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    const parts = flatten(entry, depth + 1)
    // Field name kept: "name: ..." is what tells the caller which input Plane
    // rejected, which is the whole point of relaying the body.
    const preferred = (PREFERRED_KEYS as readonly string[]).includes(key)
    return parts.map((part) => (preferred ? part : `${key}: ${part}`))
  })
}

/** Best-effort human message out of a parsed Plane error body. Returns
 *  undefined when the body carries nothing quotable, so the caller falls back
 *  to the HTTP status line. */
export function extractPlaneErrorDetail(data: unknown): string | undefined {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>
    for (const key of PREFERRED_KEYS) {
      const preferred = flatten(record[key], 1)
      if (preferred.length > 0) {
        return bounded(preferred)
      }
    }
  }
  const parts = flatten(data, 0)
  return parts.length > 0 ? bounded(parts) : undefined
}

function bounded(parts: string[]): string {
  const message = parts.join('; ')
  return message.length <= MAX_DETAIL_CHARS ? message : `${message.slice(0, MAX_DETAIL_CHARS - 1)}…`
}
