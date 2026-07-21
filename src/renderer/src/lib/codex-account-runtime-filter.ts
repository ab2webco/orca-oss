import { getWslDistroFromPath } from '@/lib/local-preflight-context'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import type { CodexManagedAccountSummary, Repo, Worktree } from '../../../shared/types'

export type CodexAccountLaunchRuntime =
  | { kind: 'host' }
  | { kind: 'wsl'; distro: string | null }
  | { kind: 'unavailable' }

/** Sentinel `DropdownMenuRadioItem` value representing "inherit the global
 *  runtime selection" (`codexAccountId: null`). Radix disallows an empty
 *  string item value, so a real null/undefined selection needs a stand-in. */
export const INHERIT_GLOBAL_CODEX_ACCOUNT_VALUE = '__inherit-global__'

type CodexAccountTargetRepo = Pick<Repo, 'connectionId' | 'executionHostId'>

export function isLocalCodexAccountWorktreeTarget(
  worktree: Pick<Worktree, 'id' | 'hostId'>,
  repo: CodexAccountTargetRepo | null | undefined
): boolean {
  // Why: ordinary worktrees use raw IDs, while synthetic folder rows use
  // workspace keys and must never receive a local credential binding.
  if (parseWorkspaceKey(worktree.id)?.type === 'folder') {
    return false
  }
  return (
    (worktree.hostId ?? (repo ? getRepoExecutionHostId(repo) : null)) === LOCAL_EXECUTION_HOST_ID
  )
}

/**
 * Filters managed Codex accounts down to those compatible with a worktree's
 * runtime: host accounts for a host path, same-distro WSL accounts for a WSL
 * path. Mirrors `claude-account-runtime-filter.ts`, keyed off the Codex
 * account's `managedHomeRuntime` instead of Claude's `managedAuthRuntime`.
 */
export function filterCodexAccountsByRuntime(
  accounts: readonly CodexManagedAccountSummary[],
  path: string | null | undefined,
  launchRuntime?: CodexAccountLaunchRuntime
): CodexManagedAccountSummary[] {
  if (launchRuntime?.kind === 'unavailable') {
    return []
  }
  const targetWslDistro =
    launchRuntime?.kind === 'wsl' ? launchRuntime.distro : getWslDistroFromPath(path)
  const targetsWsl = launchRuntime?.kind === 'wsl' || Boolean(targetWslDistro)
  return accounts.filter((account) => {
    const accountRuntime = account.managedHomeRuntime ?? 'host'
    if (!targetsWsl) {
      return accountRuntime !== 'wsl'
    }
    return accountRuntime === 'wsl' && account.wslDistro === targetWslDistro
  })
}

export function filterCodexAccountsByWorktreeRuntimes(
  accounts: readonly CodexManagedAccountSummary[],
  targets: readonly {
    path: string | null | undefined
    launchRuntime?: CodexAccountLaunchRuntime
  }[]
): CodexManagedAccountSummary[] {
  return accounts.filter((account) =>
    targets.every(
      ({ path, launchRuntime }) =>
        filterCodexAccountsByRuntime([account], path, launchRuntime).length === 1
    )
  )
}
