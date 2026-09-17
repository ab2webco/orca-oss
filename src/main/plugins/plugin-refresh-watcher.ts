import {
  subscribeViaWatcherProcess,
  type WatcherProcessSubscription
} from '../ipc/parcel-watcher-process'

type SubscribePluginPath = (
  path: string,
  onEvent: (error: Error | null) => void,
  onInterruption: () => void
) => Promise<WatcherProcessSubscription>

const subscribePluginPath: SubscribePluginPath = (path, onEvent, onInterruption) =>
  subscribeViaWatcherProcess(
    path,
    (error) => onEvent(error),
    {},
    {
      onInterruption,
      onTerminalError: onEvent
    }
  )

// Why: Parcel unsubscribe rejects when the watch root is already gone (common
// in tests that rm temp dirs). Fire-and-forget callers must not leave that as
// an unhandled rejection that fails the Vitest process.
function releaseSubscription(subscription: WatcherProcessSubscription): void {
  void subscription.unsubscribe().catch(() => undefined)
}

/**
 * Owns the debounced filesystem watchers that force a full plugin projection
 * refresh: the root of every mutable dev plugin (manifest/panel edits) and the
 * `plugins-data` directory (an external process writing a plugin's own KV, p.ej.
 * el contador `navBadge`).
 *
 * El debounce es UNO SOLO y compartido entre todas las rutas a proposito: un
 * plugin que escribe su storage en rafaga colapsa en un unico `refresh()`.
 */
export class PluginRefreshWatcher {
  private readonly subscriptions: WatcherProcessSubscription[] = []
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private generation = 0

  constructor(private readonly subscribePath: SubscribePluginPath = subscribePluginPath) {}

  start(paths: readonly string[], refresh: () => void, onWatcherError?: () => void): void {
    const generation = ++this.generation
    for (const watchedPath of paths) {
      let subscription: WatcherProcessSubscription | null = null
      let failedBeforeReady = false
      const fail = (): void => {
        if (generation !== this.generation) {
          return
        }
        failedBeforeReady = true
        if (subscription) {
          this.removeSubscription(subscription)
          releaseSubscription(subscription)
        }
        onWatcherError?.()
        this.scheduleRefresh(refresh)
      }
      void this.subscribePath(
        watchedPath,
        (error) => {
          if (error) {
            fail()
          } else if (generation === this.generation) {
            this.scheduleRefresh(refresh)
          }
        },
        () => {
          if (generation === this.generation) {
            // The watcher process recovered, but changes during the gap were
            // lost, so refresh the complete plugin projection once.
            this.scheduleRefresh(refresh)
          }
        }
      )
        .then((created) => {
          subscription = created
          if (generation !== this.generation || failedBeforeReady) {
            releaseSubscription(created)
            return
          }
          this.subscriptions.push(created)
        })
        .catch(() => {
          if (generation === this.generation) {
            onWatcherError?.()
          }
        })
    }
  }

  dispose(): void {
    this.generation += 1
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    for (const subscription of this.subscriptions.splice(0)) {
      releaseSubscription(subscription)
    }
  }

  private removeSubscription(subscription: WatcherProcessSubscription): void {
    const index = this.subscriptions.indexOf(subscription)
    if (index !== -1) {
      this.subscriptions.splice(index, 1)
    }
  }

  private scheduleRefresh(refresh: () => void): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      refresh()
    }, 300)
  }
}
