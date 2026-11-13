import { parseClaudeCodeVersion } from './hook-event-versions'

const VERSION_CACHE_MS = 10 * 60_000
// Why short: a read that timed out under load is not a missing Claude, and a launch without the game is.
const FAILED_READ_CACHE_MS = 30_000

/** Reads `claude --version` at most once per cache window, and once for launches that ask together. */
export function createClaudeCodeVersionDetector(deps: {
  run: () => Promise<string>
  now?: () => number
}): () => Promise<string | null> {
  const now = deps.now ?? Date.now
  let cached: { value: string | null; at: number } | null = null
  let reading: Promise<string | null> | null = null
  const read = async (): Promise<string | null> => {
    let value: string | null = null
    try {
      value = parseClaudeCodeVersion(await deps.run())
    } catch {
      value = null
    }
    cached = { value, at: now() }
    return value
  }
  return async () => {
    if (cached) {
      const keepFor = cached.value === null ? FAILED_READ_CACHE_MS : VERSION_CACHE_MS
      if (now() - cached.at < keepFor) {
        return cached.value
      }
    }
    reading ??= read().finally(() => {
      reading = null
    })
    return reading
  }
}
