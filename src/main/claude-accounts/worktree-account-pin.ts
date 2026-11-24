import type { ClaudeManagedAccount, GlobalSettings } from '../../shared/types'
import { parseWslUncPath } from '../../shared/wsl-paths'

type ClaudeAccountPinStore = {
  getSettings(): Pick<GlobalSettings, 'claudeManagedAccounts'>
}

type PinnedClaudeAccount = Pick<
  ClaudeManagedAccount,
  'id' | 'email' | 'managedAuthRuntime' | 'wslDistro'
> & { managedAuthPath?: string }

/** Where a launch runs: the host, or a WSL distro (null = the default distro). */
export type ClaudeLaunchRuntime = { runtime: 'host' } | { runtime: 'wsl'; wslDistro: string | null }

export function isManagedClaudeAccountId(store: ClaudeAccountPinStore, accountId: string): boolean {
  return store.getSettings().claudeManagedAccounts.some((account) => account.id === accountId)
}

export function normalizeClaudeAccountPinForCreate(
  store: ClaudeAccountPinStore,
  accountId: string | null | undefined
): string | null | undefined {
  if (typeof accountId !== 'string' || isManagedClaudeAccountId(store, accountId)) {
    return accountId
  }
  // Why: a slow worktree create may finish after its selected account was
  // removed; inherit global auth instead of durably resurrecting a dead pin.
  return null
}

export function assertValidClaudeAccountPin(
  store: ClaudeAccountPinStore,
  accountId: string | null | undefined
): void {
  if (typeof accountId === 'string' && !isManagedClaudeAccountId(store, accountId)) {
    throw new Error('That Claude account no longer exists.')
  }
}

export function claudeAccountLaunchRuntimeOf(account: PinnedClaudeAccount): ClaudeLaunchRuntime {
  if (account.managedAuthRuntime !== 'wsl') {
    return { runtime: 'host' }
  }
  // Legacy default-WSL records may omit wslDistro while their UNC path names it.
  const distro = account.wslDistro?.trim() || parseWslUncPath(account.managedAuthPath ?? '')?.distro
  return { runtime: 'wsl', wslDistro: distro || null }
}

export function claudeLaunchRuntimeLabel(target: ClaudeLaunchRuntime): string {
  if (target.runtime === 'host') {
    return 'the host'
  }
  return target.wslDistro ? `WSL ${target.wslDistro}` : 'the default WSL distro'
}

/** Why null for SSH: a remote repo's agent runs on that host, which owns its own auth. */
export function claudeLaunchRuntimeOfRepo(repo: {
  path: string
  connectionId?: string | null
}): ClaudeLaunchRuntime | null {
  if (repo.connectionId) {
    return null
  }
  const wsl = parseWslUncPath(repo.path)
  return wsl ? { runtime: 'wsl', wslDistro: wsl.distro } : { runtime: 'host' }
}

/** The refusal text when a pinned account cannot run where the launch runs, else null. */
export function claudeAccountRuntimeMismatchOf(
  account: PinnedClaudeAccount,
  target: ClaudeLaunchRuntime
): string | null {
  const own = claudeAccountLaunchRuntimeOf(account)
  // Why a default-distro side passes: which distro is the default is only known at
  // launch, where prepareForClaudeLaunch resolves it and still refuses a mismatch.
  const matches =
    own.runtime === target.runtime &&
    (own.runtime === 'host' ||
      own.wslDistro === null ||
      (target.runtime === 'wsl' &&
        (target.wslDistro === null ||
          own.wslDistro.toLowerCase() === target.wslDistro.toLowerCase())))
  if (matches) {
    return null
  }
  const where = claudeLaunchRuntimeLabel(target)
  const location = target.runtime === 'wsl' ? 'WSL' : 'Host'
  const launchesIn = target.runtime === 'wsl' ? `in ${where}` : `on ${where}`
  return `The Claude account ${account.email} lives on ${claudeLaunchRuntimeLabel(own)}, so it cannot launch Claude ${launchesIn}. Pick an account added for ${where}, or add one in Settings → Accounts with Account location set to ${location}.`
}

/** Refuses, before a worktree exists, a pin whose account cannot launch in the repo's runtime. */
export function assertClaudeAccountPinMatchesRepoRuntime(
  accounts: readonly PinnedClaudeAccount[],
  accountId: string | null | undefined,
  repo: { path: string; connectionId?: string | null }
): void {
  if (typeof accountId !== 'string') {
    return
  }
  const target = claudeLaunchRuntimeOfRepo(repo)
  const account = accounts.find((candidate) => candidate.id === accountId)
  if (!target || !account) {
    return
  }
  const mismatch = claudeAccountRuntimeMismatchOf(account, target)
  if (mismatch) {
    throw new Error(mismatch)
  }
}
