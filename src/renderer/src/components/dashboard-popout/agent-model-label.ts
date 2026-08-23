// Provider model ids, as a person reads them (ORCA-234).

const MODEL_PREFIXES = ['claude-', 'gpt-', 'gemini-', 'glm-']

/**
 * A short display name for a provider model id.
 *
 * Why a transform and not a table: the ids arrive from whatever the agent was
 * launched with, so a table would silently print nothing for the next model.
 * Keeping the id recognisable beats an empty cell.
 */
export function agentModelLabel(model: string | null | undefined): string | null {
  if (!model) {
    return null
  }
  const stripped = MODEL_PREFIXES.reduce(
    (id, prefix) => (id.startsWith(prefix) ? id.slice(prefix.length) : id),
    model
  )
  // Dated snapshots (`opus-5-20260501`) add nothing at cell size.
  const withoutDate = stripped.replace(/-\d{8}$/, '')
  return withoutDate
    .split('-')
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

/** Compact token count: the window's size, not a percentage of a guessed cap. */
export function formatContextTokens(tokens: number | null | undefined): string | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) {
    return null
  }
  if (tokens < 1000) {
    return `${tokens}`
  }
  const thousands = tokens / 1000
  return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)}k`
}
