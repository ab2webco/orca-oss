import { randomUUID } from 'node:crypto'
import type { ClaudeLiveSharedPtyAccountBinding } from '../../shared/types'
import { getClaudeLivePtyPersistence } from './claude-live-pty-persistence'
import * as ownershipEpoch from './live-pty-ownership-epoch'
import {
  notifyClaudePtyReleased,
  notifyLiveClaudePtysDrainedOnTransition
} from './live-pty-drain-listeners'
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
  sharedClaudeLaunchReservations,
  unknownOwnerSharedClaudePtyIds
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
import {
  clearInjectedClaudePtyBinding,
  confirmSeededInjectedClaudePtyBindings,
  hasSeededUnconfirmedInjectedClaudePtys,
  markInjectedClaudeCliBindingExited,
  markInjectedClaudePtyBindingSpawned,
  releaseInjectedClaudeLaunchReservation,
  seedInjectedClaudePtyBindings
} from './injected-claude-pty-binding'
const managedClaudeAccountMutations = new Set<string>()
// Why: ids restored from persistence at startup, not yet confirmed against the
// daemon. They keep the OAuth refresh gate closed so an early managed refresh
// cannot rotate the single-use refresh token out from under a Claude CLI that
// survived the app restart inside the daemon.
const seededUnconfirmedPtyIds = new Set<string>()

export function seedLiveClaudePtysFromPersistence(
  sessionIds: readonly string[],
  bindings: readonly ClaudeLiveSharedPtyAccountBinding[] = []
): void {
  const bindingBySessionId = new Map(bindings.map((binding) => [binding.sessionId, binding]))
  for (const sessionId of sessionIds) {
    const binding = bindingBySessionId.get(sessionId)
    const accountId = binding?.accountId ?? null
    liveClaudePtyIds.add(sessionId)
    liveSharedClaudePtyAccounts.set(sessionId, accountId)
    // Why: a row from a pre-binding release records no ownership, so its null is
    // unknown rather than "no managed account" — block every account until the
    // live process resolves it (resolveUnknownSharedClaudePtyOwners).
    if (accountId === null && binding?.accountResolved !== true) {
      unknownOwnerSharedClaudePtyIds.add(sessionId)
    }
    reserveLiveClaudePtyRefreshChain(sessionId, accountId)
    ownershipEpoch.recordLiveClaudePtyOwnershipEpoch(sessionId)
    seededUnconfirmedPtyIds.add(sessionId)
  }
}

export function seedLiveInjectedClaudePtysFromPersistence(
  bindings: readonly { sessionId: string; accountId: string }[]
): void {
  seedInjectedClaudePtyBindings(bindings)
}

export function hasSeededUnconfirmedClaudePtys(): boolean {
  return seededUnconfirmedPtyIds.size > 0 || hasSeededUnconfirmedInjectedClaudePtys()
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
  let releasedAny = false
  for (const sessionId of seededUnconfirmedPtyIds) {
    if (!alive.has(sessionId)) {
      liveClaudePtyIds.delete(sessionId)
      liveSharedClaudePtyAccounts.delete(sessionId)
      unknownOwnerSharedClaudePtyIds.delete(sessionId)
      releaseLiveClaudePtyRefreshChain(sessionId)
      ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(sessionId)
      getClaudeLivePtyPersistence()?.removeClaudeLivePtySessionId(sessionId)
      releasedAny = true
    }
  }
  releasedAny =
    confirmSeededInjectedClaudePtyBindings(alive, getClaudeLivePtyPersistence()) || releasedAny
  seededUnconfirmedPtyIds.clear()
  notifyLiveClaudePtysDrainedOnTransition(hadLivePtys, liveClaudePtyIds.size)
  if (releasedAny) {
    notifyClaudePtyReleased()
  }
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
  const hadUnknownOwner = unknownOwnerSharedClaudePtyIds.has(ptyId)
  const existingAccountId = liveSharedClaudePtyAccounts.get(ptyId) ?? null
  const existingOwnershipEpoch = ownershipEpoch.getLiveClaudePtyOwnershipEpoch(ptyId)
  const bindingAccountId = hadExistingAccount ? existingAccountId : accountId
  // Why only a first spawn resolves ownership: a reattach to a surviving process
  // carries the CURRENT global selection, which says nothing about what that
  // process has owned since before the restart. Clearing the unknown there would
  // silently declare a legacy PTY unmanaged (ORCA-190).
  const resolvesOwnership = !hadExistingAccount
  try {
    liveClaudePtyIds.add(ptyId)
    liveSharedClaudePtyAccounts.set(ptyId, bindingAccountId)
    if (resolvesOwnership) {
      unknownOwnerSharedClaudePtyIds.delete(ptyId)
    }
    try {
      if (!options?.persistenceAlreadyRecorded) {
        getClaudeLivePtyPersistence()?.addClaudeLivePtySessionId(ptyId, bindingAccountId, {
          accountResolved: resolvesOwnership
        })
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
      if (resolvesOwnership && hadUnknownOwner) {
        unknownOwnerSharedClaudePtyIds.add(ptyId)
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
  markInjectedClaudePtyBindingSpawned(
    ptyId,
    accountId,
    reservationId,
    getClaudeLivePtyPersistence(),
    options
  )
}

/**
 * Releases the account owned by a Claude CLI that exited while its shell PTY
 * stays alive. A mismatched owner fails closed so this cannot become a general
 * live-terminal reassignment escape hatch.
 */
export function markInjectedClaudeCliExited(ptyId: string, accountId: string): boolean {
  return markInjectedClaudeCliBindingExited(ptyId, accountId, getClaudeLivePtyPersistence())
}

export function markClaudePtyExited(ptyId: string): void {
  const hadLivePtys = liveClaudePtyIds.size > 0
  // Why: teardown is called for ids that were never live; only a real release
  // can quiet a universe, so only a real release signals the retry work.
  const wasLive = liveClaudePtyIds.has(ptyId) || liveInjectedClaudePtyAccounts.has(ptyId)
  liveClaudePtyIds.delete(ptyId)
  liveSharedClaudePtyAccounts.delete(ptyId)
  unknownOwnerSharedClaudePtyIds.delete(ptyId)
  releaseLiveClaudePtyRefreshChain(ptyId)
  seededUnconfirmedPtyIds.delete(ptyId)
  getClaudeLivePtyPersistence()?.removeClaudeLivePtySessionId(ptyId)
  ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(ptyId)
  clearInjectedClaudePtyBinding(ptyId, getClaudeLivePtyPersistence())
  notifyLiveClaudePtysDrainedOnTransition(hadLivePtys, liveClaudePtyIds.size)
  if (wasLive) {
    notifyClaudePtyReleased()
  }
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
  if (accountId !== null && hasLiveInjectedClaudePtysForAccount(accountId)) {
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
  releaseInjectedClaudeLaunchReservation(reservationId)
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
export {
  attachLiveClaudeTerminalDescriptions,
  attachLiveClaudeWorktreeDisplayNames
} from './live-pty-blocker-description'
export {
  attachClaudeLivePtyPersistence,
  type ClaudeLivePtyPersistence
} from './claude-live-pty-persistence'
export { recordResolvedSharedClaudePtyOwner } from './resolved-shared-claude-pty-owner'
export * from './claude-auth-switch-gate'
export * from './live-pty-account-ownership'
