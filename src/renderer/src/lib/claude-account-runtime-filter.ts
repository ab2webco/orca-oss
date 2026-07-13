import { getWslDistroFromPath } from '@/lib/local-preflight-context'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import type { ClaudeManagedAccountSummary, Repo, Worktree } from '../../../shared/types'

export type ClaudeAccountLaunchRuntime =
  | { kind: 'host' }
  | { kind: 'wsl'; distro: string | null }
  | { kind: 'unavailable' }

/** Sentinel `Select`/`DropdownMenuRadioItem` value representing "inherit the
 *  global host selection" (`claudeAccountId: null`). Radix disallows an empty
 *  string item value, so a real null/undefined selection needs a stand-in. */
export const INHERIT_GLOBAL_CLAUDE_ACCOUNT_VALUE = '__inherit-global__'

type ClaudeAccountTargetRepo = Pick<Repo, 'connectionId' | 'executionHostId'>

export function isLocalClaudeAccountRepoTarget(
  repo: ClaudeAccountTargetRepo | null | undefined
): boolean {
  return Boolean(repo && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID)
}

export function canOfferClaudeAccountPinForRepoTarget(args: {
  repo: ClaudeAccountTargetRepo | null | undefined
  isFolderWorkspaceTarget: boolean
  selectedRepoIsRemote: boolean
  isPairedWebClient: boolean
}): boolean {
  return (
    !args.isPairedWebClient &&
    !args.isFolderWorkspaceTarget &&
    !args.selectedRepoIsRemote &&
    isLocalClaudeAccountRepoTarget(args.repo)
  )
}

export function isLocalClaudeAccountWorktreeTarget(
  worktree: Pick<Worktree, 'id' | 'hostId'>,
  repo: ClaudeAccountTargetRepo | null | undefined
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
 * Filters managed Claude accounts down to those compatible with a worktree's
 * (or about-to-be-created worktree's) runtime: host accounts for a host path,
 * same-distro WSL accounts for a WSL path. Mirrors the lightweight path-based
 * WSL signal `local-preflight-context.ts` already uses as its own fallback —
 * a worktree/repo path under `\\wsl$\<distro>\...` is on that distro, anything
 * else is host. See SPEC "Account ↔ runtime compatibility".
 */
export function filterClaudeAccountsByRuntime(
  accounts: readonly ClaudeManagedAccountSummary[],
  path: string | null | undefined,
  launchRuntime?: ClaudeAccountLaunchRuntime
): ClaudeManagedAccountSummary[] {
  if (launchRuntime?.kind === 'unavailable') {
    return []
  }
  const targetWslDistro =
    launchRuntime?.kind === 'wsl' ? launchRuntime.distro : getWslDistroFromPath(path)
  const targetsWsl = launchRuntime?.kind === 'wsl' || Boolean(targetWslDistro)
  return accounts.filter((account) => {
    const accountRuntime = account.managedAuthRuntime ?? 'host'
    if (!targetsWsl) {
      return accountRuntime !== 'wsl'
    }
    return accountRuntime === 'wsl' && account.wslDistro === targetWslDistro
  })
}

export function filterClaudeAccountsByWorktreeRuntimes(
  accounts: readonly ClaudeManagedAccountSummary[],
  targets: readonly {
    path: string | null | undefined
    launchRuntime?: ClaudeAccountLaunchRuntime
  }[]
): ClaudeManagedAccountSummary[] {
  return accounts.filter((account) =>
    targets.every(
      ({ path, launchRuntime }) =>
        filterClaudeAccountsByRuntime([account], path, launchRuntime).length === 1
    )
  )
}
