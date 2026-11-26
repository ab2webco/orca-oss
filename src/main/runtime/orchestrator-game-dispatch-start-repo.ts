function startOptionOf(startOptions: string | null | undefined, name: string): string | null {
  try {
    const parsed: unknown = startOptions ? JSON.parse(startOptions) : null
    const value = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, name) : null
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/** The `--repo` selector a worker start recorded in its start options; null in the lead's own repo. */
export function repoOf(startOptions: string | null): string | null {
  return startOptionOf(startOptions, 'repo')
}

/** The worktree of the lead that started a remote member; it outlives the lead's panes (ORCA-943). */
export function leadWorktreeIdOfStartOptions(
  startOptions: string | null | undefined
): string | null {
  return startOptionOf(startOptions, 'leadWorktreeId')
}
