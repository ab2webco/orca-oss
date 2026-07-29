// Why: a live claude defers the managed OAuth refresh ("Waiting for Claude
// session"); consumers need the 1 -> 0 transition to recover promptly instead
// of waiting out the usage-fetch failure backoff.
type LiveClaudePtyDrainListener = () => void

const drainListeners = new Set<LiveClaudePtyDrainListener>()

export function onLiveClaudePtysDrained(listener: LiveClaudePtyDrainListener): () => void {
  drainListeners.add(listener)
  return () => drainListeners.delete(listener)
}

// Why: fire only on the live 1 -> 0 transition, not on every teardown call.
export function notifyLiveClaudePtysDrainedOnTransition(
  hadLivePtys: boolean,
  remainingLivePtys: number
): void {
  if (!hadLivePtys || remainingLivePtys > 0) {
    return
  }
  for (const listener of drainListeners) {
    listener()
  }
}

type ClaudePtyReleaseListener = () => void

const releaseListeners = new Set<ClaudePtyReleaseListener>()

/** Fires on every Claude PTY release, unlike the 1 -> 0 drain above: per-universe
 *  work (the transcript link) retries the moment ONE universe quiets, and on a
 *  fan-out machine that happens long before the global count reaches zero. */
export function onClaudePtyReleased(listener: ClaudePtyReleaseListener): () => void {
  releaseListeners.add(listener)
  return () => releaseListeners.delete(listener)
}

export function notifyClaudePtyReleased(): void {
  for (const listener of releaseListeners) {
    listener()
  }
}
