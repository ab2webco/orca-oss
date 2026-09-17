import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import type { DiscoveredPlugin } from './plugin-discovery'
import type { WatchedPluginPath } from './plugin-refresh-watcher'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  dispose: vi.fn()
}))

vi.mock('./plugin-refresh-watcher', () => ({
  PluginRefreshWatcher: class {
    start = mocks.start
    dispose = mocks.dispose
  }
}))

const { PluginServiceHousekeeping, pluginDataWatchDir } =
  await import('./plugin-service-housekeeping')

const pluginsDataDir = join(tmpdir(), 'orca-housekeeping-plugins-data')

function watchedPaths(): WatchedPluginPath[] {
  return mocks.start.mock.calls.at(-1)?.[0] as WatchedPluginPath[]
}

afterEach(() => {
  mocks.start.mockClear()
  mocks.dispose.mockClear()
})

describe('PluginServiceHousekeeping watched paths', () => {
  function sync(overrides: { devPaths?: string[]; watchPluginData?: boolean } = {}): void {
    new PluginServiceHousekeeping().sync({
      enabled: true,
      devPaths: overrides.devPaths ?? [],
      pluginDataDir: overrides.watchPluginData ? pluginsDataDir : null,
      reapIdle: vi.fn(),
      refresh: vi.fn()
    })
  }

  it('watches nothing at all when no plugin can badge a nav entry', () => {
    sync()
    // Without this the feature would hand a recursive data-dir watch to every
    // user with the plugin system on, including those with no nav panels.
    expect(watchedPaths()).toEqual([])
  })

  it('adds the data dir only when a nav panel exists, and never its audit log', () => {
    sync({ devPaths: ['/plugins/demo'], watchPluginData: true })

    expect(watchedPaths()).toEqual([
      { path: '/plugins/demo' },
      { path: pluginsDataDir, ignore: ['audit.log', 'audit.log.1'] }
    ])
  })

  it('keeps dev paths unwatched-for-data when nav panels go away', () => {
    sync({ devPaths: ['/plugins/demo'] })

    expect(watchedPaths()).toEqual([{ path: '/plugins/demo' }])
  })
})

describe('pluginDataWatchDir', () => {
  function plugin(surface: 'worktree' | 'settings' | 'nav'): DiscoveredPlugin {
    return {
      pluginKey: `orca-samples.${surface}`,
      rootDir: join(tmpdir(), 'plugins', surface),
      manifest: pluginManifestSchema.parse({
        manifestVersion: 1,
        id: surface,
        publisher: 'orca-samples',
        name: surface,
        version: '1.0.0',
        engines: { orca: '>=1.0.0' },
        pluginApi: 1,
        contributes: {
          panels: [{ id: 'p', title: 'P', entry: 'p.html', surface }]
        },
        capabilities: []
      }),
      consentFingerprint: 'sha256-current',
      contentHash: null,
      isDev: true
    }
  }

  it('asks for the data dir only when a nav panel could badge itself', () => {
    expect(pluginDataWatchDir('/userData', [plugin('nav')])).toBe('/userData/plugins-data')
    expect(pluginDataWatchDir('/userData', [plugin('worktree'), plugin('settings')])).toBeNull()
    expect(pluginDataWatchDir('/userData', [])).toBeNull()
  })

  it('ignores an unreadable plugin instead of throwing on its missing manifest', () => {
    const invalid: DiscoveredPlugin = {
      rootDir: join(tmpdir(), 'plugins', 'broken'),
      error: 'missing orca-plugin.json',
      isDev: true
    }
    expect(pluginDataWatchDir('/userData', [invalid])).toBeNull()
    expect(pluginDataWatchDir('/userData', [invalid, plugin('nav')])).toBe('/userData/plugins-data')
  })
})
