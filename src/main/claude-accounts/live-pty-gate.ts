import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import * as ownershipEpoch from './live-pty-ownership-epoch'

const liveClaudePtyIds = new Set<string>()
// Why: exported for sibling account-removal enumeration; only this module mutates them.
export const liveSharedClaudePtyAccounts = new Map<string, string | null>()
export const liveInjectedClaudePtyAccounts = new Map<string, string>()
const injectedClaudeLaunchReservations = new Map<string, string>()
const sharedClaudeLaunchReservations = new Map<string, string | null>()
const managedClaudeAccountMutations = new Set<string>()
const managedClaudeAccountMutationContext = new AsyncLocalStorage<ReadonlySet<string>>()
// Why: ids restored from persistence at startup, not yet confirmed against the
// daemon. They keep the OAuth refresh gate closed so an early managed refresh
// cannot rotate the single-use refresh token out from under a Claude CLI that
// survived the app restart inside the daemon.
const seededUnconfirmedPtyIds = new Set<string>()
const seededUnconfirmedInjectedPtyIds = new Set<string>()
let switchInProgress = false

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
    ownershipEpoch.recordLiveClaudePtyOwnershipEpoch(sessionId)
    seededUnconfirmedPtyIds.add(sessionId)
  }
}

export function seedLiveInjectedClaudePtysFromPersistence(
  bindings: readonly { sessionId: string; accountId: string }[]
): void {
  for (const { sessionId, accountId } of bindings) {
    liveInjectedClaudePtyAccounts.set(sessionId, accountId)
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
  const alive = new Set(aliveSessionIds)
  for (const sessionId of seededUnconfirmedPtyIds) {
    if (!alive.has(sessionId)) {
      liveClaudePtyIds.delete(sessionId)
      liveSharedClaudePtyAccounts.delete(sessionId)
      ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(sessionId)
      persistence?.removeClaudeLivePtySessionId(sessionId)
    }
  }
  for (const sessionId of seededUnconfirmedInjectedPtyIds) {
    if (!alive.has(sessionId)) {
      liveInjectedClaudePtyAccounts.delete(sessionId)
      ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(sessionId)
      persistence?.removeClaudeLivePtyAccountBinding?.(sessionId)
    }
  }
  seededUnconfirmedPtyIds.clear()
  seededUnconfirmedInjectedPtyIds.clear()
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
  liveClaudePtyIds.delete(ptyId)
  liveSharedClaudePtyAccounts.delete(ptyId)
  seededUnconfirmedPtyIds.delete(ptyId)
  persistence?.removeClaudeLivePtySessionId(ptyId)
  liveInjectedClaudePtyAccounts.delete(ptyId)
  ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(ptyId)
  seededUnconfirmedInjectedPtyIds.delete(ptyId)
  persistence?.removeClaudeLivePtyAccountBinding?.(ptyId)
}

export function hasLiveClaudePtys(): boolean {
  return liveClaudePtyIds.size > 0
}

export function isLiveSharedClaudePty(ptyId: string): boolean {
  return liveClaudePtyIds.has(ptyId)
}

export function getLiveSharedClaudePtyAccountId(ptyId: string): string | null {
  return liveSharedClaudePtyAccounts.get(ptyId) ?? null
}

export function hasLiveSharedClaudePtysForAccount(accountId: string): boolean {
  return [...liveSharedClaudePtyAccounts.values()].some(
    (liveAccountId) => liveAccountId === null || liveAccountId === accountId
  )
}

export function hasLiveInjectedClaudePtysForAccount(accountId: string): boolean {
  return (
    [...liveInjectedClaudePtyAccounts.values()].includes(accountId) ||
    [...injectedClaudeLaunchReservations.values()].includes(accountId)
  )
}

export function getLiveInjectedClaudePtyAccountId(ptyId: string): string | null {
  return liveInjectedClaudePtyAccounts.get(ptyId) ?? null
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
    throw new Error(
      'This Claude account is already in use by a global terminal. Close it before launching the assigned account.'
    )
  }
  const reservationId = randomUUID()
  injectedClaudeLaunchReservations.set(reservationId, accountId)
  return reservationId
}

export function reserveSharedClaudeAccountLaunch(accountId: string | null): string {
  if (switchInProgress) {
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
    throw new Error(
      'This Claude account is in use by an assigned worktree. Close that Claude terminal before launching it globally.'
    )
  }
  const reservationId = randomUUID()
  sharedClaudeLaunchReservations.set(reservationId, accountId)
  return reservationId
}

export function beginManagedClaudeAccountMutation(
  accountId: string,
  allowLiveSharedPtys = false
): void {
  if (
    hasLiveInjectedClaudePtysForAccount(accountId) ||
    (!allowLiveSharedPtys && hasLiveSharedClaudePtysForAccount(accountId)) ||
    [...sharedClaudeLaunchReservations.values()].some(
      (reservedAccountId) => reservedAccountId === null || reservedAccountId === accountId
    )
  ) {
    throw new Error(
      'This Claude account is in use by an assigned worktree. Close its Claude terminal before changing the account.'
    )
  }
  if (managedClaudeAccountMutations.has(accountId)) {
    throw new Error('This Claude account is already being changed.')
  }
  managedClaudeAccountMutations.add(accountId)
}

export function endManagedClaudeAccountMutation(accountId: string): void {
  managedClaudeAccountMutations.delete(accountId)
}

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

export function releaseInjectedClaudeAccountLaunch(reservationId: string | undefined): void {
  if (!reservationId) {
    return
  }
  injectedClaudeLaunchReservations.delete(reservationId)
}

export function releaseSharedClaudeAccountLaunch(reservationId: string | undefined): void {
  if (!reservationId) {
    return
  }
  sharedClaudeLaunchReservations.delete(reservationId)
}

export function beginClaudeAuthSwitch(): void {
  if (switchInProgress) {
    throw new Error('A Claude account switch is already in progress.')
  }
  if (sharedClaudeLaunchReservations.size > 0) {
    // Why: shared auth must not change after launch preparation but before the
    // PTY is registered in the durable live-session gate.
    throw new Error('A global Claude terminal is starting. Try again when it finishes.')
  }
  switchInProgress = true
}

export function endClaudeAuthSwitch(): void {
  switchInProgress = false
}

export function isClaudeAuthSwitchInProgress(): boolean {
  return switchInProgress
}
