const ownershipEpochs = new Map<string, number>()
let nextOwnershipEpoch = 1

export function recordLiveClaudePtyOwnershipEpoch(ptyId: string, epoch?: number): void {
  ownershipEpochs.set(ptyId, epoch ?? nextOwnershipEpoch)
  if (epoch !== undefined) {
    return
  }
  nextOwnershipEpoch += 1
}

export function clearLiveClaudePtyOwnershipEpoch(ptyId: string): void {
  ownershipEpochs.delete(ptyId)
}

export function getLiveClaudePtyOwnershipEpoch(ptyId: string): number | null {
  return ownershipEpochs.get(ptyId) ?? null
}

/** The epoch the next registration will take. Snapshot it before an async
 *  liveness probe so anything registered while the probe runs (epoch >= cursor)
 *  can be excluded from a release decision the probe could not have seen. */
export function peekNextLiveClaudePtyOwnershipEpoch(): number {
  return nextOwnershipEpoch
}

export function restoreLiveClaudePtyOwnershipEpoch(ptyId: string, epoch: number | null): void {
  if (epoch === null) {
    clearLiveClaudePtyOwnershipEpoch(ptyId)
  } else {
    recordLiveClaudePtyOwnershipEpoch(ptyId, epoch)
  }
}
