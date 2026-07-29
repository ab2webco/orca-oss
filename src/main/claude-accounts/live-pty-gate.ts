import { randomUUID } from 'node:crypto'
import * as ownershipEpoch from './live-pty-ownership-epoch'
import { notifyLiveClaudePtysDrainedOnTransition } from './live-pty-drain-listeners'
import {
  releaseClaudeLaunchRefreshChain,
  releaseLiveClaudePtyRefreshChain,
  reserveClaudeLaunchRefreshChain,
  reserveLiveClaudePtyRefreshChain,
  transferClaudeLaunchRefreshChain
} from './live-claude-refresh-chain-claims'
import {
  injectedClaudeLaunchReservations,
  liveClaudePtyIds,
  liveInjectedClaudePtyAccounts,
  liveSharedClaudePtyAccounts,
  sharedClaudeLaunchReservations
} from './live-pty-account-state'
import {
  hasLiveInjectedClaudePtysForAccount,
  hasLiveSharedClaudePtysForAccount
} from './live-pty-account-ownership'
import {
  clearClaudeLaunchReservationExpiry,
  scheduleClaudeLaunchReservationExpiry
} from './claude-launch-reservation-lifetime'
import {
  assertSharedLaunchAllowsManagedAccountMutation,
  type ManagedClaudeAccountMutationOptions
} from './managed-claude-account-mutation-policy'
import { isClaudeAuthSwitchInProgress } from './claude-auth-switch-gate'
import {
  createAccountMutationBlockError,
  createAssignedWorktreeLaunchBlockError,
  createGlobalTerminalLaunchBlockError
} from './live-pty-blocker-description'
const managedClaudeAccountMutations = new Set<string>()
// Why: ids restored from persistence at startup, not yet confirmed against the
// daemon. They keep the OAuth refresh gate closed so an early managed refresh
// cannot rotate the single-use refresh token out from under a Claude CLI that
// survived the app restart inside the daemon.
const seededUnconfirmedPtyIds = new Set<string>()
const seededUnconfirmedInjectedPtyIds = new Set<string>()

export type ClaudeLivePtyPersistence = {
  addClaudeLivePtySessionId(sessionId: string, accountId?: string | null): void
  removeClaudeLivePtySessionId(sessionId: string): void
  addClaudeLivePtyAccountBinding?(sessionId: string, accountId: string): void
  removeClaudeLivePtyAccountBinding?(sessionId: string): void
}

let persistence: ClaudeLivePtyPersistence | null = null

export function attachClaudeLivePtyPersistence(target: ClaudeLivePtyPersistence | null): void {
  persistence = target
}

export function seedLiveClaudePtysFromPersistence(
  sessionIds: readonly string[],
  bindings: readonly { sessionId: string; accountId: string | null }[] = []
): void {
  const accountBySessionId = new Map(
    bindings.map((binding) => [binding.sessionId, binding.accountId])
  )
  for (const sessionId of sessionIds) {
    liveClaudePtyIds.add(sessionId)
    // Why: pre-binding releases have unknown ownership; block them
    // conservatively instead of assuming the current global account.
    liveSharedClaudePtyAccounts.set(sessionId, accountBySessionId.get(sessionId) ?? null)
    reserveLiveClaudePtyRefreshChain(sessionId, accountBySessionId.get(sessionId) ?? null)
    ownershipEpoch.recordLiveClaudePtyOwnershipEpoch(sessionId)
    seededUnconfirmedPtyIds.add(sessionId)
  }
}

export function seedLiveInjectedClaudePtysFromPersistence(
  bindings: readonly { sessionId: string; accountId: string }[]
): void {
  for (const { sessionId, accountId } of bindings) {
    liveInjectedClaudePtyAccounts.set(sessionId, accountId)
    reserveLiveClaudePtyRefreshChain(sessionId, accountId)
    ownershipEpoch.recordLiveClaudePtyOwnershipEpoch(sessionId)
    seededUnconfirmedInjectedPtyIds.add(sessionId)
  }
}

export function hasSeededUnconfirmedClaudePtys(): boolean {
  return seededUnconfirmedPtyIds.size > 0 || seededUnconfirmedInjectedPtyIds.size > 0
}

/**
 * Reconcile seeded ids against the daemon's live session list. Seeded ids the
 * daemon no longer knows are dead — release them so they cannot defer OAuth
 * refresh forever. Seeded ids that are still alive stay in the gate even if
 * their pane never reattaches: that daemon process still owns the credentials.
 */
export function confirmSeededClaudeLivePtys(aliveSessionIds: readonly string[]): void {
  const hadLivePtys = liveClaudePtyIds.size > 0
  const alive = new Set(aliveSessionIds)
  for (const sessionId of seededUnconfirmedPtyIds) {
    if (!alive.has(sessionId)) {
      liveClaudePtyIds.delete(sessionId)
      liveSharedClaudePtyAccounts.delete(sessionId)
      releaseLiveClaudePtyRefreshChain(sessionId)
      ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(sessionId)
      persistence?.removeClaudeLivePtySessionId(sessionId)
    }
  }
  for (const sessionId of seededUnconfirmedInjectedPtyIds) {
    if (!alive.has(sessionId)) {
      liveInjectedClaudePtyAccounts.delete(sessionId)
      releaseLiveClaudePtyRefreshChain(sessionId)
      ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(sessionId)
      persistence?.removeClaudeLivePtyAccountBinding?.(sessionId)
    }
  }
  seededUnconfirmedPtyIds.clear()
  seededUnconfirmedInjectedPtyIds.clear()
  notifyLiveClaudePtysDrainedOnTransition(hadLivePtys, liveClaudePtyIds.size)
}

export function markClaudePtySpawned(
  ptyId: string,
  accountId: string | null = null,
  reservationId?: string,
  options?: { persistenceAlreadyRecorded?: boolean }
): void {
  if (
    reservationId &&
    (!sharedClaudeLaunchReservations.has(reservationId) ||
      sharedClaudeLaunchReservations.get(reservationId) !== accountId)
  ) {
    throw new Error('The shared Claude account launch reservation is no longer valid.')
  }
  const wasLive = liveClaudePtyIds.has(ptyId)
  const hadExistingAccount = liveSharedClaudePtyAccounts.has(ptyId)
  const existingAccountId = liveSharedClaudePtyAccounts.get(ptyId) ?? null
  const existingOwnershipEpoch = ownershipEpoch.getLiveClaudePtyOwnershipEpoch(ptyId)
  const bindingAccountId = hadExistingAccount ? existingAccountId : accountId
  try {
    liveClaudePtyIds.add(ptyId)
    liveSharedClaudePtyAccounts.set(ptyId, bindingAccountId)
    try {
      if (!options?.persistenceAlreadyRecorded) {
        persistence?.addClaudeLivePtySessionId(ptyId, bindingAccountId)
      }
      seededUnconfirmedPtyIds.delete(ptyId)
      ownershipEpoch.recordLiveClaudePtyOwnershipEpoch(ptyId)
      if (reservationId) {
        transferClaudeLaunchRefreshChain(reservationId, ptyId)
      } else if (!wasLive) {
        reserveLiveClaudePtyRefreshChain(ptyId, bindingAccountId)
      }
    } catch (error) {
      liveClaudePtyIds.delete(ptyId)
      if (wasLive) {
        liveClaudePtyIds.add(ptyId)
      }
      if (hadExistingAccount) {
        liveSharedClaudePtyAccounts.set(ptyId, existingAccountId)
      } else {
        liveSharedClaudePtyAccounts.delete(ptyId)
      }
      ownershipEpoch.restoreLiveClaudePtyOwnershipEpoch(ptyId, existingOwnershipEpoch)
      throw error
    }
  } finally {
    releaseSharedClaudeAccountLaunch(reservationId)
  }
}

export function markInjectedClaudePtySpawned(
  ptyId: string,
  accountId: string,
  reservationId?: string,
  options?: { persistenceAlreadyRecorded?: boolean }
): void {
  const existingAccountId = liveInjectedClaudePtyAccounts.get(ptyId)
  const existingOwnershipEpoch = ownershipEpoch.getLiveClaudePtyOwnershipEpoch(ptyId)
  const reservedAccountId = reservationId
    ? injectedClaudeLaunchReservations.get(reservationId)
    : undefined
  if (existingAccountId && existingAccountId !== accountId) {
    throw new Error('A live Claude terminal cannot change its assigned account.')
  }
  if (reservationId && reservedAccountId !== accountId) {
    throw new Error('The Claude account launch reservation is no longer valid.')
  }
  try {
    liveInjectedClaudePtyAccounts.set(ptyId, accountId)
    try {
      if (!options?.persistenceAlreadyRecorded) {
        persistence?.addClaudeLivePtyAccountBinding?.(ptyId, accountId)
      }
      seededUnconfirmedInjectedPtyIds.delete(ptyId)
      ownershipEpoch.recordLiveClaudePtyOwnershipEpoch(ptyId)
      if (reservationId) {
        transferClaudeLaunchRefreshChain(reservationId, ptyId)
      } else if (!existingAccountId) {
        reserveLiveClaudePtyRefreshChain(ptyId, accountId)
      }
    } catch (error) {
      if (existingAccountId) {
        liveInjectedClaudePtyAccounts.set(ptyId, existingAccountId)
      } else {
        liveInjectedClaudePtyAccounts.delete(ptyId)
      }
      ownershipEpoch.restoreLiveClaudePtyOwnershipEpoch(ptyId, existingOwnershipEpoch)
      throw error
    }
  } finally {
    releaseInjectedClaudeAccountLaunch(reservationId)
  }
}

export function markClaudePtyExited(ptyId: string): void {
  const hadLivePtys = liveClaudePtyIds.size > 0
  liveClaudePtyIds.delete(ptyId)
  liveSharedClaudePtyAccounts.delete(ptyId)
  releaseLiveClaudePtyRefreshChain(ptyId)
  seededUnconfirmedPtyIds.delete(ptyId)
  persistence?.removeClaudeLivePtySessionId(ptyId)
  liveInjectedClaudePtyAccounts.delete(ptyId)
  ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(ptyId)
  seededUnconfirmedInjectedPtyIds.delete(ptyId)
  persistence?.removeClaudeLivePtyAccountBinding?.(ptyId)
  notifyLiveClaudePtysDrainedOnTransition(hadLivePtys, liveClaudePtyIds.size)
}

export function reserveInjectedClaudeAccountLaunch(
  accountId: string,
  // Why: custom-endpoint accounts authenticate with a static token in their own
  // universe's settings.json — there is no single-use OAuth refresh chain a live
  // shared terminal could fork, so those launches opt out of the shared-PTY gate.
  options: { allowLiveSharedPtys?: boolean } = {}
): string {
  if (managedClaudeAccountMutations.has(accountId)) {
    throw new Error('This Claude account is being changed. Try again when the change finishes.')
  }
  if (
    [...sharedClaudeLaunchReservations.values()].some(
      (reservedAccountId) => reservedAccountId === null || reservedAccountId === accountId
    )
  ) {
    throw new Error('This Claude account is being launched globally. Try again when it finishes.')
  }
  if (!options.allowLiveSharedPtys && hasLiveSharedClaudePtysForAccount(accountId)) {
    throw createGlobalTerminalLaunchBlockError(accountId)
  }
  const reservationId = randomUUID()
  injectedClaudeLaunchReservations.set(reservationId, accountId)
  reserveClaudeLaunchRefreshChain(reservationId, accountId)
  scheduleClaudeLaunchReservationExpiry(reservationId, releaseInjectedClaudeAccountLaunch)
  return reservationId
}

export function reserveSharedClaudeAccountLaunch(accountId: string | null): string {
  if (isClaudeAuthSwitchInProgress()) {
    throw new Error('A Claude account switch is in progress. Try again after it finishes.')
  }
  if (
    accountId === null
      ? managedClaudeAccountMutations.size > 0
      : managedClaudeAccountMutations.has(accountId)
  ) {
    throw new Error('This Claude account is being changed. Try again when the change finishes.')
  }
  if (
    accountId === null
      ? liveInjectedClaudePtyAccounts.size > 0 || injectedClaudeLaunchReservations.size > 0
      : hasLiveInjectedClaudePtysForAccount(accountId)
  ) {
    throw createAssignedWorktreeLaunchBlockError(accountId)
  }
  const reservationId = randomUUID()
  sharedClaudeLaunchReservations.set(reservationId, accountId)
  reserveClaudeLaunchRefreshChain(reservationId, accountId)
  scheduleClaudeLaunchReservationExpiry(reservationId, releaseSharedClaudeAccountLaunch)
  return reservationId
}

export function beginManagedClaudeAccountMutation(
  accountId: string,
  options: ManagedClaudeAccountMutationOptions = {}
): void {
  if (
    hasLiveInjectedClaudePtysForAccount(accountId) ||
    (!options.allowLiveSharedPtys && hasLiveSharedClaudePtysForAccount(accountId))
  ) {
    throw createAccountMutationBlockError(accountId, !options.allowLiveSharedPtys)
  }
  assertSharedLaunchAllowsManagedAccountMutation(
    accountId,
    sharedClaudeLaunchReservations,
    options.intent
  )
  if (managedClaudeAccountMutations.has(accountId)) {
    throw new Error('This Claude account is already being changed.')
  }
  managedClaudeAccountMutations.add(accountId)
}

/** True while a managed mutation holds this account. Read-only callers use this
 *  to yield to an in-flight credential swap without taking the live-PTY gate. */
export function isManagedClaudeAccountMutating(accountId: string): boolean {
  return managedClaudeAccountMutations.has(accountId)
}

export function endManagedClaudeAccountMutation(accountId: string): void {
  managedClaudeAccountMutations.delete(accountId)
}

export function releaseInjectedClaudeAccountLaunch(reservationId: string | undefined): void {
  if (!reservationId) {
    return
  }
  clearClaudeLaunchReservationExpiry(reservationId)
  injectedClaudeLaunchReservations.delete(reservationId)
  releaseClaudeLaunchRefreshChain(reservationId)
}

export function releaseSharedClaudeAccountLaunch(reservationId: string | undefined): void {
  if (!reservationId) {
    return
  }
  clearClaudeLaunchReservationExpiry(reservationId)
  sharedClaudeLaunchReservations.delete(reservationId)
  releaseClaudeLaunchRefreshChain(reservationId)
}

export { liveInjectedClaudePtyAccounts, liveSharedClaudePtyAccounts }
export { attachLiveClaudeWorktreeDisplayNames } from './live-pty-blocker-description'
export * from './claude-auth-switch-gate'
export * from './live-pty-account-ownership'
