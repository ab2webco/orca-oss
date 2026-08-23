// Model and context size of a transcript's newest assistant turn (ORCA-234).
//
// Why here and not a second pass: the tail scan already walks these records, so
// this reads the first assistant row it meets and then stops. No extra I/O, no
// wider byte budget.

/** What the window holds, as the provider counted it for the last request. */
export type TranscriptModelUsage = {
  /** Provider model id, e.g. `claude-opus-5`. Null when the row omits it. */
  model: string | null
  /** Prompt tokens the last request carried, cache included. */
  contextTokens: number
}

function numberAt(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Reads one JSONL record, or null when it is not an assistant row with usage.
 *
 * Why the sum and not `input_tokens`: a cached turn reports almost everything
 * under the cache fields, so input alone reads as a nearly empty window.
 */
export function decodeTranscriptModelUsage(line: string): TranscriptModelUsage | null {
  if (!line.startsWith('{') || !line.includes('"usage"')) {
    return null
  }
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof record !== 'object' || record === null) {
    return null
  }
  const message = (record as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) {
    return null
  }
  const usage = (message as { usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) {
    return null
  }
  const counts = usage as Record<string, unknown>
  const model = (message as { model?: unknown }).model
  return {
    model: typeof model === 'string' && model ? model : null,
    contextTokens:
      numberAt(counts, 'input_tokens') +
      numberAt(counts, 'cache_read_input_tokens') +
      numberAt(counts, 'cache_creation_input_tokens')
  }
}
