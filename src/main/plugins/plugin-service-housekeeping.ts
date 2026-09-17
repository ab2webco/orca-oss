import { mkdirSync } from 'node:fs'
import { PluginRefreshWatcher } from './plugin-refresh-watcher'

/** Starts and stops lifecycle maintenance as the feature flag and watched paths change. */
export class PluginServiceHousekeeping {
  private readonly watcher = new PluginRefreshWatcher()
  private reapTimer: ReturnType<typeof setInterval> | null = null
  private watchedPathsKey: string | null = null

  sync(options: {
    enabled: boolean
    devPaths: readonly string[]
    /** `<userData>/plugins-data`: a plugin worker or an external process can
     *  rewrite a plugin's own KV (p.ej. el contador `navBadge`) sin pasar por
     *  el host, y esa escritura tiene que llegar al sidebar sola. */
    pluginsDataDir: string
    reapIdle: () => void
    refresh: () => void
  }): void {
    if (!options.enabled) {
      this.stop()
      return
    }
    if (!this.reapTimer) {
      this.reapTimer = setInterval(options.reapIdle, 60_000)
      this.reapTimer.unref?.()
    }
    // Why: the data dir is created lazily on the first KV write, and watching a
    // missing path fails forever; creating it up front makes the watch stick.
    try {
      mkdirSync(options.pluginsDataDir, { recursive: true })
    } catch {
      // A data dir we cannot create simply stays unwatched; the projection
      // still refreshes on every other plugin change.
    }
    const watchedPaths = [...options.devPaths, options.pluginsDataDir]
    const pathsKey = JSON.stringify(watchedPaths)
    if (pathsKey !== this.watchedPathsKey) {
      this.watcher.dispose()
      this.watcher.start(watchedPaths, options.refresh, () => {
        // The next refresh retries a failed watcher even when the configured
        // path list itself did not change.
        this.watchedPathsKey = null
      })
      this.watchedPathsKey = pathsKey
    }
  }

  dispose(): void {
    this.stop()
  }

  private stop(): void {
    if (this.reapTimer) {
      clearInterval(this.reapTimer)
      this.reapTimer = null
    }
    this.watcher.dispose()
    this.watchedPathsKey = null
  }
}
