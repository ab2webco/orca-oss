import { getWslDistroFromPath } from '@/lib/local-preflight-context'
import type { ClaudeManagedAccountSummary } from '../../../shared/types'

/** Sentinel `Select`/`DropdownMenuRadioItem` value representing "inherit the
 *  global host selection" (`claudeAccountId: null`). Radix disallows an empty
 *  string item value, so a real null/undefined selection needs a stand-in. */
export const INHERIT_GLOBAL_CLAUDE_ACCOUNT_VALUE = '__inherit-global__'

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
  path: string | null | undefined
): ClaudeManagedAccountSummary[] {
  const targetWslDistro = getWslDistroFromPath(path)
  return accounts.filter((account) => {
    const accountRuntime = account.managedAuthRuntime ?? 'host'
    if (!targetWslDistro) {
      return accountRuntime !== 'wsl'
    }
    return accountRuntime === 'wsl' && (account.wslDistro ?? null) === targetWslDistro
  })
}
