import {
  injectedClaudeLaunchReservations,
  liveClaudePtyIds,
  liveInjectedClaudePtyAccounts,
  liveSharedClaudePtyAccounts,
  sharedClaudeLaunchReservations,
  unknownOwnerSharedClaudePtyIds
} from './live-pty-account-state'

export function hasLiveClaudePtys(): boolean {
  return liveClaudePtyIds.size > 0
}

export function isLiveSharedClaudePty(ptyId: string): boolean {
  return liveClaudePtyIds.has(ptyId)
}

export function getLiveSharedClaudePtyAccountId(ptyId: string): string | null {
  return liveSharedClaudePtyAccounts.get(ptyId) ?? null
}

/**
 * Any live Claude CLI at all, pinned or not. Reservations are excluded, so a
 * caller inside its own launch preparation does not see itself.
 *
 * Why the broad question has a use: every universe Orca links shares one
 * transcript store, so a migration in one of them moves files the CLI of any
 * other may be mid-append on. Per-account liveness cannot answer that.
 */
export function hasAnyLiveClaudePtys(): boolean {
  return liveClaudePtyIds.size > 0 || liveInjectedClaudePtyAccounts.size > 0
}

/**
 * Only a shared PTY whose owner is still unknown blocks every account. One whose
 * owner is known — a managed account id, or `null` for "ran against the user's
 * own login, so it owns no managed refresh chain" — blocks that account alone.
 */
export function hasLiveSharedClaudePtysForAccount(accountId: string): boolean {
  return (
    unknownOwnerSharedClaudePtyIds.size > 0 ||
    [...liveSharedClaudePtyAccounts.values()].includes(accountId)
  )
}

export function hasUnknownOwnerLiveSharedClaudePtys(): boolean {
  return unknownOwnerSharedClaudePtyIds.size > 0
}

export function isUnknownOwnerLiveSharedClaudePty(ptyId: string): boolean {
  return unknownOwnerSharedClaudePtyIds.has(ptyId)
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

/** Bindings only, unlike hasLiveInjectedClaudePtysForAccount: a launch
 *  reservation has no CLI process yet, so nothing can be mid-append inside that
 *  vault — counting it would defer the very launch that is preparing it. */
export function hasLiveInjectedClaudePtyBoundToAccount(accountId: string): boolean {
  return [...liveInjectedClaudePtyAccounts.values()].includes(accountId)
}

export function hasLiveClaudePtysUsingAccount(accountId: string): boolean {
  return (
    hasLiveInjectedClaudePtysForAccount(accountId) || hasLiveSharedClaudePtysForAccount(accountId)
  )
}

export function getLiveClaudeRotationOwnership(): {
  accountIds: readonly string[]
  hasUnknownAccount: boolean
} {
  const sharedAccountIds = [...liveSharedClaudePtyAccounts.values()]
  const reservedSharedAccountIds = [...sharedClaudeLaunchReservations.values()]
  const accountIds = new Set([
    ...liveInjectedClaudePtyAccounts.values(),
    ...injectedClaudeLaunchReservations.values(),
    ...sharedAccountIds.filter((accountId): accountId is string => accountId !== null),
    ...reservedSharedAccountIds.filter((accountId): accountId is string => accountId !== null)
  ])
  return {
    accountIds: [...accountIds],
    // Why background rotation stays conservative where the launch gate no longer
    // is: a paused auto-rotation costs a stale usage read, while rotating a chain
    // a live CLI turns out to hold logs that session out. An unmanaged shared PTY
    // still reads the shared runtime dir, and a global switch may materialize a
    // managed account into it (doSelectAccount allows that under a live shared
    // PTY), so its `null` is not proof no managed chain is exposed.
    hasUnknownAccount:
      unknownOwnerSharedClaudePtyIds.size > 0 ||
      sharedAccountIds.includes(null) ||
      reservedSharedAccountIds.includes(null)
  }
}
