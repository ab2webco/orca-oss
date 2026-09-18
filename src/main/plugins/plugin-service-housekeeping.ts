import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_AUDIT_LOG_FILE_NAMES } from './plugin-audit-log'
import {
  getPluginsDataDir,
  isInvalidDiscoveredPlugin,
  type DiscoveredPlugin
} from './plugin-discovery'
import { PluginRefreshWatcher, type WatchedPluginPath } from './plugin-refresh-watcher'

/**
 * The plugin data dir to watch, or `null` when nothing there can change on its
 * own: only a `surface: 'nav'` panel reads a key an external process writes
 * (`navBadge`), so no nav panel means no recursive watch for that user.
 */
export function pluginDataWatchDir(
  userDataPath: string,
  plugins: readonly DiscoveredPlugin[]
): string | null {
  const hasNavPanel = plugins.some(
    (plugin) =>
      !isInvalidDiscoveredPlugin(plugin) &&
      plugin.manifest.contributes.panels.some((panel) => panel.surface === 'nav')
  )
  return hasNavPanel ? getPluginsDataDir(userDataPath) : null
}

/** Starts and stops lifecycle maintenance as the feature flag and watched paths change. */
export class PluginServiceHousekeeping {
  private readonly watcher = new PluginRefreshWatcher()
  private reapTimer: ReturnType<typeof setInterval> | null = null
  private watchedPathsKey: string | null = null

  sync(options: {
    enabled: boolean
    devPaths: readonly string[]
    /** `<userData>/plugins-data` when something there must reach the sidebar on
     *  its own — un proceso externo reescribiendo el KV de un plugin, p.ej. el
     *  contador `navBadge` — y `null` cuando no hay nada que vigilar. */
    pluginDataDir: string | null
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
    const watchedPaths: WatchedPluginPath[] = options.devPaths.map((path) => ({ path }))
    if (options.pluginDataDir) {
      const dataDir = options.pluginDataDir
      watchedPaths.push({
        path: dataDir,
        // El audit log vive en la raiz de este dir y lo escribe el host en cada
        // mutacion mediada: vigilarlo seria refrescar por nuestro propio ruido.
        // Parcel compara rutas, no nombres sueltos.
        ignore: PLUGIN_AUDIT_LOG_FILE_NAMES.map((name) => join(dataDir, name))
      })
    }
    const pathsKey = JSON.stringify(watchedPaths)
    if (pathsKey !== this.watchedPathsKey) {
      // Why: the data dir is created lazily on the first KV write, and watching
      // a missing path fails forever; creating it up front makes the watch stick.
      if (options.pluginDataDir) {
        try {
          mkdirSync(options.pluginDataDir, { recursive: true })
        } catch {
          // A data dir we cannot create simply stays unwatched; the projection
          // still refreshes on every other plugin change.
        }
      }
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
