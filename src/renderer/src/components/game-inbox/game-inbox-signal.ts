/** A paired host's new-mail event, relayed to an open Inbox; the local runtime pushes over IPC instead. */
const listeners = new Set<() => void>()

export function onGameInboxChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function signalGameInboxChanged(): void {
  for (const listener of listeners) {
    listener()
  }
}
