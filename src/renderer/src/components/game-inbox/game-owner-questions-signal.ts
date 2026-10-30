/** A paired host's change event, relayed to the Inbox; the local runtime pushes over IPC instead. */
const listeners = new Set<() => void>()

export function onGameOwnerQuestionsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function signalGameOwnerQuestionsChanged(): void {
  for (const listener of listeners) {
    listener()
  }
}
