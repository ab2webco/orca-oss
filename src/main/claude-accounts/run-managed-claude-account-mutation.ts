import { AsyncLocalStorage } from 'node:async_hooks'
import {
  beginManagedClaudeAccountMutation,
  endManagedClaudeAccountMutation,
  getLiveClaudeRotationOwnership,
  isManagedClaudeAccountMutating
} from './live-pty-gate'
import {
  fingerprintClaudeRefreshChain,
  type ClaudeRefreshChainFingerprint
} from './claude-refresh-chain-fingerprint'
import {
  claudeRefreshChainLeaseStore,
  type ClaudeRefreshChainLeaseStore
} from './claude-refresh-chain-lease'
import {
  getManagedClaudeRefreshAccounts,
  readManagedClaudeRefreshCredentials
} from './claude-managed-refresh-chain'
import {
  inspectManagedClaudeRefreshChainAliases,
  type ManagedClaudeRefreshChainAliasStatus
} from './claude-refresh-chain-alias-registry'

// Why: nested managed mutations (e.g. a switch that spawns a refresh) must not
// re-acquire the gate for an account already held by an outer mutation on the
// same async chain; the context tracks accounts owned up the call stack.
const managedClaudeAccountMutationContext = new AsyncLocalStorage<ReadonlySet<string>>()

export async function runManagedClaudeAccountMutation<T>(
  accountId: string,
  operation: () => Promise<T>,
  allowLiveSharedPtys = false
): Promise<T> {
  const inherited = managedClaudeAccountMutationContext.getStore()
  if (inherited?.has(accountId)) {
    return operation()
  }
  beginManagedClaudeAccountMutation(accountId, allowLiveSharedPtys)
  try {
    return await managedClaudeAccountMutationContext.run(
      new Set([...(inherited ?? []), accountId]),
      operation
    )
  } finally {
    endManagedClaudeAccountMutation(accountId)
  }
}

/**
 * Best-effort variant for short mutations embedded in read paths (e.g. a usage
 * read's token rotation): acquires the same gate, but yields — `acquired: false`
 * instead of throwing — when a live session, launch reservation, or mutation
 * already owns the account. The atomic acquire re-checks liveness, closing the
 * race where a Claude launch starts between a caller's liveness check and the
 * rotation it guards.
 */
export async function tryRunManagedClaudeAccountMutation<T>(
  accountId: string,
  operation: () => Promise<T>
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const inherited = managedClaudeAccountMutationContext.getStore()
  if (inherited?.has(accountId)) {
    return { acquired: true, value: await operation() }
  }
  try {
    beginManagedClaudeAccountMutation(accountId)
  } catch {
    return { acquired: false }
  }
  try {
    return {
      acquired: true,
      value: await managedClaudeAccountMutationContext.run(
        new Set([...(inherited ?? []), accountId]),
        operation
      )
    }
  } finally {
    endManagedClaudeAccountMutation(accountId)
  }
}

type BackgroundRotationDependencies = {
  leaseStore?: ClaudeRefreshChainLeaseStore
  readManagedCredentials?: (accountId: string) => Promise<string | null>
  inspectAliases?: (
    accountId: string,
    fingerprint: ClaudeRefreshChainFingerprint
  ) => Promise<ManagedClaudeRefreshChainAliasStatus>
}

const warnedAliasAccounts = new Set<string>()

export async function tryRunManagedClaudeAccountBackgroundRotation<T>(
  accountId: string,
  credentialsJson: string,
  operation: () => Promise<T>,
  dependencies: BackgroundRotationDependencies = {}
): Promise<
  { acquired: true; value: T } | { acquired: false; reason?: 'refresh-chain-alias' | 'unresolved' }
> {
  const fingerprint = fingerprintClaudeRefreshChain(credentialsJson)
  if (!fingerprint) {
    return { acquired: false }
  }
  const inspectAliases =
    dependencies.inspectAliases ??
    (getManagedClaudeRefreshAccounts().length > 0
      ? inspectManagedClaudeRefreshChainAliases
      : async () => ({ status: 'unique' as const }))
  const aliasStatus = await inspectAliases(accountId, fingerprint)
  if (aliasStatus.status === 'alias-conflict') {
    await warnAliasConflict(aliasStatus.accountIds)
    return { acquired: false, reason: 'refresh-chain-alias' }
  }
  if (aliasStatus.status === 'unresolved') {
    return { acquired: false }
  }
  if (
    !(await isRefreshChainAvailableLocally(
      fingerprint,
      dependencies.readManagedCredentials ?? readManagedClaudeRefreshCredentials
    ))
  ) {
    return { acquired: false }
  }

  const inherited = managedClaudeAccountMutationContext.getStore()
  if (!inherited?.has(accountId)) {
    try {
      beginManagedClaudeAccountMutation(accountId)
    } catch {
      return { acquired: false }
    }
  }
  const leaseStore = dependencies.leaseStore ?? claudeRefreshChainLeaseStore
  const lease = leaseStore.tryAcquireRotation(fingerprint)
  if (!lease) {
    if (!inherited?.has(accountId)) {
      endManagedClaudeAccountMutation(accountId)
    }
    return { acquired: false }
  }
  try {
    const value = await managedClaudeAccountMutationContext.run(
      new Set([...(inherited ?? []), accountId]),
      operation
    )
    return { acquired: true, value }
  } finally {
    lease.release()
    if (!inherited?.has(accountId)) {
      endManagedClaudeAccountMutation(accountId)
    }
  }
}

async function warnAliasConflict(accountIds: readonly string[]): Promise<void> {
  const warningKey = [...accountIds].sort().join('\0')
  if (warnedAliasAccounts.has(warningKey)) {
    return
  }
  warnedAliasAccounts.add(warningKey)
  console.warn(
    '[claude-refresh-chain] Automatic token rotation paused because managed accounts share one OAuth grant; re-authenticate one duplicate account.',
    { accountIds: [...accountIds].sort() }
  )
  try {
    const { dialog } = await import('electron')
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Claude account refresh paused',
      message: 'Some managed Claude accounts share one OAuth grant.',
      detail:
        'Orca paused automatic refresh to protect active sessions. Re-authenticate one duplicate account in Settings to create an independent grant.'
    })
  } catch {
    // Headless runtimes retain the durable marker and diagnostic warning.
  }
}

async function isRefreshChainAvailableLocally(
  candidate: ClaudeRefreshChainFingerprint,
  readManagedCredentials: (accountId: string) => Promise<string | null>
): Promise<boolean> {
  const ownership = getLiveClaudeRotationOwnership()
  if (ownership.hasUnknownAccount) {
    return false
  }
  for (const liveAccountId of ownership.accountIds) {
    const credentialsJson = await readWithTimeout(readManagedCredentials(liveAccountId))
    if (!credentialsJson) {
      return false
    }
    const liveFingerprint = fingerprintClaudeRefreshChain(credentialsJson)
    if (!liveFingerprint || liveFingerprint === candidate) {
      return false
    }
  }
  return true
}

async function readWithTimeout<T>(operation: Promise<T>): Promise<T | null> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), 4_000)
      })
    ])
  } catch {
    return null
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

/**
 * Runs a READ against a managed account, serialized against mutations of that
 * same account but without the live-PTY gate.
 *
 * Why: the gate exists to stop an account from being *changed* under a running
 * Claude terminal. A usage read changes nothing, so applying the gate to it made
 * the usage of every worktree-pinned account with an open terminal permanently
 * unreadable — exactly the account the user wants to see. Waiting on an
 * in-flight mutation is still required so a read can't observe half-swapped
 * credentials, so the read yields to the mutation instead of racing it.
 */
export async function runManagedClaudeAccountRead<T>(
  accountId: string,
  operation: () => Promise<T>
): Promise<T> {
  const inherited = managedClaudeAccountMutationContext.getStore()
  if (inherited?.has(accountId)) {
    return operation()
  }
  if (isManagedClaudeAccountMutating(accountId)) {
    // Why: a read must not interleave with an in-flight credential swap; skipping
    // it lets the caller retry on its next cycle with settled credentials.
    throw new Error('This Claude account is already being changed.')
  }
  return operation()
}
