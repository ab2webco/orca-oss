import { randomUUID } from 'node:crypto'
import { fingerprintClaudeRefreshChain } from './claude-refresh-chain-fingerprint'
import { claudeRefreshChainLeaseStore } from './claude-refresh-chain-lease'
import { readManagedClaudeRefreshCredentials } from './claude-managed-refresh-chain'
import { shouldTrackClaudePtyCredentials } from './claude-pty-credential-location'

const claimOwnerByGateId = new Map<string, string>()

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
    void resolveClaimFingerprint(ownerId, accountId)
  }
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
