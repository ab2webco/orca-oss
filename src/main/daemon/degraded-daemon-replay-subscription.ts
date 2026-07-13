import type { IPtyProvider } from '../providers/types'

export function subscribeToDegradedDaemonReplay(
  providers: IPtyProvider[],
  trackedUnsubscribers: (() => void)[],
  callback: (payload: { id: string; data: string }) => void
): () => void {
  const providerUnsubscribers = providers.map((provider) => provider.onReplay(callback))
  let active = true
  const unsubscribe = (): void => {
    if (!active) {
      return
    }
    active = false
    const trackedIndex = trackedUnsubscribers.indexOf(unsubscribe)
    if (trackedIndex !== -1) {
      trackedUnsubscribers.splice(trackedIndex, 1)
    }
    for (const providerUnsubscribe of providerUnsubscribers) {
      providerUnsubscribe()
    }
  }
  trackedUnsubscribers.push(unsubscribe)
  return unsubscribe
}
