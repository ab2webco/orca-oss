import { join } from 'node:path'
import type { ClaudeManagedAccount } from '../../shared/types'

/**
 * Every host Claude universe whose transcripts the AI Vault must scan.
 *
 * Why: a worktree pinned to a managed account launches Claude with that
 * account's vault as `CLAUDE_CONFIG_DIR`, so its conversations are written to
 * `<vault>/projects/` and never to `~/.claude/projects/`. Scanning only the
 * shared home hid every pinned session from history, and offering a home
 * session for resume inside a pinned worktree launched an id the vault does not
 * hold — the CLI then reports "No conversation found with session ID".
 *
 * WSL vaults are excluded: their paths are Linux paths inside the distro, which
 * this host-local scan cannot read. Mirrors Codex's per-account home discovery.
 */
export function getManagedClaudeProjectsPathsForSessionDiscovery(
  accounts: readonly ClaudeManagedAccount[]
): string[] {
  const paths = accounts
    .filter((account) => account.managedAuthRuntime !== 'wsl' && Boolean(account.managedAuthPath))
    .map((account) => join(account.managedAuthPath, 'projects'))
  return [...new Set(paths)]
}
