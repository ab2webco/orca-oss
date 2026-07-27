import { randomUUID } from 'node:crypto'
import { fingerprintClaudeRefreshChain } from './claude-refresh-chain-fingerprint'
import { claudeRefreshChainLeaseStore } from './claude-refresh-chain-lease'
import { readManagedClaudeRefreshCredentials } from './claude-managed-refresh-chain'
import { shouldTrackClaudePtyCredentials } from './claude-pty-credential-location'

const claimOwnerByGateId = new Map<string, string>()
// Why remember the account per claim: the fingerprint has to be re-read on every heartbeat, and
// the claim record deliberately persists only the digest — never the account it came from.
const accountIdByOwnerId = new Map<string, string>()
let renewalObserverInstalled = false

function liveClaudePtyClaimId(ptyId: string): string {
  return `pty-${ptyId}`
}

function claudeLaunchReservationClaimId(reservationId: string): string {
  return `reservation-${reservationId}`
}

export function reserveLiveClaudePtyRefreshChain(
  ptyId: string,
  accountId: string | null,
  credentialLocation: 'local' | 'remote' = 'local'
): void {
  if (!shouldTrackClaudePtyCredentials({ credentialLocation })) {
    return
  }
  reserveLiveClaudeRefreshChain(liveClaudePtyClaimId(ptyId), accountId)
}

export function reserveClaudeLaunchRefreshChain(
  reservationId: string,
  accountId: string | null
): void {
  reserveLiveClaudeRefreshChain(claudeLaunchReservationClaimId(reservationId), accountId)
}

export function transferClaudeLaunchRefreshChain(reservationId: string, ptyId: string): void {
  transferLiveClaudeRefreshChain(
    claudeLaunchReservationClaimId(reservationId),
    liveClaudePtyClaimId(ptyId)
  )
}

export function releaseLiveClaudePtyRefreshChain(ptyId: string): void {
  releaseLiveClaudeRefreshChain(liveClaudePtyClaimId(ptyId))
}

export function releaseClaudeLaunchRefreshChain(reservationId: string): void {
  releaseLiveClaudeRefreshChain(claudeLaunchReservationClaimId(reservationId))
}

export function reserveLiveClaudeRefreshChain(gateId: string, accountId: string | null): void {
  const ownerId = randomUUID()
  claimOwnerByGateId.set(gateId, ownerId)
  claudeRefreshChainLeaseStore.registerClaim(ownerId)
  if (accountId) {
    accountIdByOwnerId.set(ownerId, accountId)
    installRenewalObserver()
    void resolveClaimFingerprint(ownerId, accountId)
  }
}

// Why re-resolve on every heartbeat: a live CLI rotates its own refresh token as it works, so a
// fingerprint captured at registration stops matching the chain it is meant to protect within
// minutes — and background rotation then finds no claim for the current chain and rotates it,
// which strands the session that was supposed to be protected.
function installRenewalObserver(): void {
  if (renewalObserverInstalled) {
    return
  }
  renewalObserverInstalled = true
  claudeRefreshChainLeaseStore.setRenewalObserver(() => {
    for (const [ownerId, accountId] of accountIdByOwnerId) {
      void resolveClaimFingerprint(ownerId, accountId)
    }
  })
}

export function transferLiveClaudeRefreshChain(fromGateId: string, toGateId: string): void {
  const ownerId = claimOwnerByGateId.get(fromGateId)
  if (!ownerId) {
    return
  }
  claimOwnerByGateId.delete(fromGateId)
  claimOwnerByGateId.set(toGateId, ownerId)
}

export function releaseLiveClaudeRefreshChain(gateId: string): void {
  const ownerId = claimOwnerByGateId.get(gateId)
  if (!ownerId) {
    return
  }
  claimOwnerByGateId.delete(gateId)
  accountIdByOwnerId.delete(ownerId)
  claudeRefreshChainLeaseStore.releaseClaim(ownerId)
}

async function resolveClaimFingerprint(ownerId: string, accountId: string): Promise<void> {
  try {
    const credentialsJson = await readManagedClaudeRefreshCredentials(accountId)
    if (!credentialsJson) {
      return
    }
    const fingerprint = fingerprintClaudeRefreshChain(credentialsJson)
    if (fingerprint) {
      claudeRefreshChainLeaseStore.setClaimFingerprint(ownerId, fingerprint)
    }
  } catch {
    // Unknown claims intentionally block background rotation until the session exits.
  }
}
