import { relative, sep } from 'node:path'

/**
 * Recovers the managed account id from a Claude `CLAUDE_CONFIG_DIR`.
 *
 * Why: a worktree-pinned (injected) Claude session runs against its own managed
 * config dir and never becomes the globally active account, so live usage posts
 * from it can only be attributed by mapping that dir back to its account.
 * Managed dirs are always `<root>/<accountId>/auth`; anything else (the shared
 * ~/.claude, a path outside the root, or a deeper/shallower shape) is not a
 * managed account and must return null rather than a guess.
 *
 * Both inputs are expected pre-normalized/canonicalized by the caller — this is
 * a pure path-shape check so it stays testable without touching the filesystem.
 */
export function resolveManagedClaudeAccountIdFromConfigDir(
  configDir: string | null | undefined,
  managedAccountsRoot: string | null | undefined
): string | null {
  if (!configDir || !managedAccountsRoot) {
    return null
  }
  const relativePath = relative(managedAccountsRoot, configDir)
  if (!relativePath || relativePath.startsWith('..') || relativePath.includes(`..${sep}`)) {
    return null
  }
  const parts = relativePath.split(sep)
  if (parts.length !== 2 || parts[1] !== 'auth' || !parts[0]) {
    return null
  }
  return parts[0]
}
