import { randomUUID } from 'node:crypto'

const liveClaudePtyIds = new Set<string>()
const liveSharedClaudePtyAccounts = new Map<string, string | null>()
const liveInjectedClaudePtyAccounts = new Map<string, string>()
const injectedClaudeLaunchReservations = new Map<string, string>()
const sharedClaudeLaunchReservations = new Map<string, string | null>()
const managedClaudeAccountMutations = new Set<string>()
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
    seededUnconfirmedPtyIds.add(sessionId)
  }
}

export function seedLiveInjectedClaudePtysFromPersistence(
  bindings: readonly { sessionId: string; accountId: string }[]
): void {
  for (const { sessionId, accountId } of bindings) {
    liveInjectedClaudePtyAccounts.set(sessionId, accountId)
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
      persistence?.removeClaudeLivePtySessionId(sessionId)
    }
  }
  for (const sessionId of seededUnconfirmedInjectedPtyIds) {
    if (!alive.has(sessionId)) {
      liveInjectedClaudePtyAccounts.delete(sessionId)
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
  const wasSeededUnconfirmed = seededUnconfirmedPtyIds.has(ptyId)
  const hadExistingAccount = liveSharedClaudePtyAccounts.has(ptyId)
  const existingAccountId = liveSharedClaudePtyAccounts.get(ptyId) ?? null
  const bindingAccountId = hadExistingAccount ? existingAccountId : accountId
  try {
    liveClaudePtyIds.add(ptyId)
    liveSharedClaudePtyAccounts.set(ptyId, bindingAccountId)
    seededUnconfirmedPtyIds.delete(ptyId)
    try {
      if (!options?.persistenceAlreadyRecorded) {
        persistence?.addClaudeLivePtySessionId(ptyId, bindingAccountId)
      }
    } catch (error) {
      liveClaudePtyIds.delete(ptyId)
      if (wasLive) {
        liveClaudePtyIds.add(ptyId)
      }
      if (wasSeededUnconfirmed) {
        seededUnconfirmedPtyIds.add(ptyId)
      }
      if (hadExistingAccount) {
        liveSharedClaudePtyAccounts.set(ptyId, existingAccountId)
      } else {
        liveSharedClaudePtyAccounts.delete(ptyId)
      }
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
    seededUnconfirmedInjectedPtyIds.delete(ptyId)
    try {
      if (!options?.persistenceAlreadyRecorded) {
        persistence?.addClaudeLivePtyAccountBinding?.(ptyId, accountId)
      }
    } catch (error) {
      if (existingAccountId) {
        liveInjectedClaudePtyAccounts.set(ptyId, existingAccountId)
      } else {
        liveInjectedClaudePtyAccounts.delete(ptyId)
      }
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

export function reserveInjectedClaudeAccountLaunch(accountId: string): string {
  if (managedClaudeAccountMutations.has(accountId)) {
    throw new Error('This Claude account is being changed. Try again when the change finishes.')
  }
  if ([...sharedClaudeLaunchReservations.values()].includes(accountId)) {
    throw new Error('This Claude account is being launched globally. Try again when it finishes.')
  }
  if (hasLiveSharedClaudePtysForAccount(accountId)) {
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
  if (accountId && managedClaudeAccountMutations.has(accountId)) {
    throw new Error('This Claude account is being changed. Try again when the change finishes.')
  }
  if (accountId && hasLiveInjectedClaudePtysForAccount(accountId)) {
    throw new Error(
      'This Claude account is in use by an assigned worktree. Close that Claude terminal before launching it globally.'
    )
  }
  const reservationId = randomUUID()
  sharedClaudeLaunchReservations.set(reservationId, accountId)
  return reservationId
}

export function beginManagedClaudeAccountMutation(accountId: string): void {
  if (
    hasLiveInjectedClaudePtysForAccount(accountId) ||
    [...sharedClaudeLaunchReservations.values()].includes(accountId)
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
