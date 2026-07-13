export const LEGACY_WORKTREE_META_CONCURRENCY = 8

export function hasClaudeAccountPinUpdate(update: Readonly<Record<string, unknown>>): boolean {
  return Object.prototype.hasOwnProperty.call(update, 'claudeAccountId')
}

export async function runLegacyWorktreeMetaUpdates<T>(
  updates: readonly T[],
  updateOne: (update: T) => Promise<unknown>
): Promise<void> {
  let nextIndex = 0
  const failures: unknown[] = []
  const workerCount = Math.min(LEGACY_WORKTREE_META_CONCURRENCY, updates.length)

  // Why: old runtimes require one RPC per row; cap transport pressure and let
  // every admitted write settle before the caller refreshes authoritative state.
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < updates.length) {
        const update = updates[nextIndex++]
        try {
          await updateOne(update)
        } catch (error) {
          failures.push(error)
        }
      }
    })
  )
  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more legacy worktree metadata updates failed.')
  }
}
