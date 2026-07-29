import * as ownershipEpoch from './live-pty-ownership-epoch'
import {
  releaseClaudeLaunchRefreshChain,
  releaseLiveClaudePtyRefreshChain,
  reserveLiveClaudePtyRefreshChain,
  transferClaudeLaunchRefreshChain
} from './live-claude-refresh-chain-claims'
import {
  injectedClaudeLaunchReservations,
  liveInjectedClaudePtyAccounts
} from './live-pty-account-state'
import { clearClaudeLaunchReservationExpiry } from './claude-launch-reservation-lifetime'

export type InjectedClaudePtyBindingPersistence = {
  addClaudeLivePtyAccountBinding?(sessionId: string, accountId: string): void
  removeClaudeLivePtyAccountBinding?(sessionId: string): void
}

const seededUnconfirmedInjectedPtyIds = new Set<string>()

export function seedInjectedClaudePtyBindings(
  bindings: readonly { sessionId: string; accountId: string }[]
): void {
  for (const { sessionId, accountId } of bindings) {
    liveInjectedClaudePtyAccounts.set(sessionId, accountId)
    reserveLiveClaudePtyRefreshChain(sessionId, accountId)
    ownershipEpoch.recordLiveClaudePtyOwnershipEpoch(sessionId)
    seededUnconfirmedInjectedPtyIds.add(sessionId)
  }
}

export function hasSeededUnconfirmedInjectedClaudePtys(): boolean {
  return seededUnconfirmedInjectedPtyIds.size > 0
}

export function confirmSeededInjectedClaudePtyBindings(
  aliveSessionIds: ReadonlySet<string>,
  persistence: InjectedClaudePtyBindingPersistence | null
): void {
  for (const sessionId of seededUnconfirmedInjectedPtyIds) {
    if (!aliveSessionIds.has(sessionId)) {
      liveInjectedClaudePtyAccounts.delete(sessionId)
      releaseLiveClaudePtyRefreshChain(sessionId)
      ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(sessionId)
      persistence?.removeClaudeLivePtyAccountBinding?.(sessionId)
    }
  }
  seededUnconfirmedInjectedPtyIds.clear()
}

export function markInjectedClaudePtyBindingSpawned(
  ptyId: string,
  accountId: string,
  reservationId: string | undefined,
  persistence: InjectedClaudePtyBindingPersistence | null,
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
    releaseInjectedClaudeLaunchReservation(reservationId)
  }
}

export function markInjectedClaudeCliBindingExited(
  ptyId: string,
  accountId: string,
  persistence: InjectedClaudePtyBindingPersistence | null
): boolean {
  if (liveInjectedClaudePtyAccounts.get(ptyId) !== accountId) {
    return false
  }
  liveInjectedClaudePtyAccounts.delete(ptyId)
  releaseLiveClaudePtyRefreshChain(ptyId)
  seededUnconfirmedInjectedPtyIds.delete(ptyId)
  persistence?.removeClaudeLivePtyAccountBinding?.(ptyId)
  // Why: invalidate a delayed provider-exit observation from the old ownership;
  // the destination commit records a fresh epoch for the same surviving PTY.
  ownershipEpoch.clearLiveClaudePtyOwnershipEpoch(ptyId)
  return true
}

export function clearInjectedClaudePtyBinding(
  ptyId: string,
  persistence: InjectedClaudePtyBindingPersistence | null
): void {
  liveInjectedClaudePtyAccounts.delete(ptyId)
  seededUnconfirmedInjectedPtyIds.delete(ptyId)
  persistence?.removeClaudeLivePtyAccountBinding?.(ptyId)
}

export function releaseInjectedClaudeLaunchReservation(reservationId: string | undefined): void {
  if (!reservationId) {
    return
  }
  clearClaudeLaunchReservationExpiry(reservationId)
  injectedClaudeLaunchReservations.delete(reservationId)
  releaseClaudeLaunchRefreshChain(reservationId)
}
