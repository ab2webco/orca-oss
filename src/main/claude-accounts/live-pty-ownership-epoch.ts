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

export function restoreLiveClaudePtyOwnershipEpoch(ptyId: string, epoch: number | null): void {
  if (epoch === null) {
    clearLiveClaudePtyOwnershipEpoch(ptyId)
  } else {
    recordLiveClaudePtyOwnershipEpoch(ptyId, epoch)
  }
}
