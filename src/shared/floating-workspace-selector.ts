/**
 * Synthetic worktree id for PTYs, tabs and files that live in Orca's app-owned floating
 * workspace instead of a repository; shared so main, renderer and CLI agree on the sentinel.
 */
export const FLOATING_TERMINAL_WORKTREE_ID = 'global-floating-terminal'

/** User-facing `--worktree` alias; the UI calls this scope the "floating workspace". */
export const FLOATING_WORKSPACE_SELECTOR_ALIAS = 'floating'

/** Canonical runtime selector the alias expands to. */
export const FLOATING_WORKSPACE_WORKTREE_SELECTOR = `id:${FLOATING_TERMINAL_WORKTREE_ID}`

/** True when a worktree selector names the floating workspace, in alias or expanded form. */
export function isFloatingWorkspaceSelector(selector: string | undefined): boolean {
  const trimmed = selector?.trim()
  return (
    trimmed === FLOATING_WORKSPACE_SELECTOR_ALIAS ||
    trimmed === FLOATING_TERMINAL_WORKTREE_ID ||
    trimmed === FLOATING_WORKSPACE_WORKTREE_SELECTOR
  )
}
