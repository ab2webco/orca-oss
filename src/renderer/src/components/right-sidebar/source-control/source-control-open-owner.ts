import { useAppStore } from '@/store'
import { getExplicitRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'

/**
 * Who owns a file a Source Control row is about to open.
 *
 * Why this exists: `openFile` treats an ABSENT `runtimeEnvironmentId` as
 * "inherit the app's active runtime", and the resolver behind that inheritance
 * still carries a pre-owner-projection fallback — with exactly one saved
 * runtime environment, a worktree that publishes no host fields is declared
 * owned by whichever environment is focused. For a LOCAL worktree that means
 * the read is sent to the server, which answers, correctly, that it has no
 * worktree by that id: `selector_not_found`, and the retry button re-sends the
 * same call forever because the tab is already stamped.
 *
 * The Explorer never hit this because it resolves an owner per row. These rows
 * did not, so the same file opened from the tree and from Changes could land on
 * different hosts. Using the EXPLICIT resolver is the point: it answers null
 * rather than guessing, and null encodes "local" instead of "inherit".
 */
export type SourceControlOpenOwner = {
  runtimeEnvironmentId: string | undefined
  suppressActiveRuntimeFallback: boolean
}

// Why a plain function and not a hook: it reads the store imperatively, so a
// hook would only hand every caller a fresh closure each render and force its
// useCallback deps to churn.
export function resolveSourceControlOpenOwner(worktreeId: string): SourceControlOpenOwner {
  const owner = getExplicitRuntimeEnvironmentIdForWorktree(useAppStore.getState(), worktreeId)
  return {
    runtimeEnvironmentId: owner ?? undefined,
    suppressActiveRuntimeFallback: owner === null
  }
}
