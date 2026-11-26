/** A paired host's fleet change, relayed to its open Team panel; the local runtime pushes over IPC instead. */
const listeners = new Set<(environmentId: string) => void>()

export function onGameFleetChanged(listener: (environmentId: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function signalGameFleetChanged(environmentId: string): void {
  for (const listener of listeners) {
    listener(environmentId)
  }
}
