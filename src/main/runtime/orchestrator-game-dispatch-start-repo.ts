/** The `--repo` selector a worker start recorded in its start options; null in the lead's own repo. */
export function repoOf(startOptions: string | null): string | null {
  try {
    const parsed: unknown = startOptions ? JSON.parse(startOptions) : null
    const repo = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'repo') : null
    return typeof repo === 'string' && repo.length > 0 ? repo : null
  } catch {
    return null
  }
}
