/** A paired host's new Jev report, relayed to the Team panel; the local runtime pushes over IPC instead. */
const listeners = new Set<() => void>()

export function onGameAdvisorChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function signalGameAdvisorChanged(): void {
  for (const listener of listeners) {
    listener()
  }
}
