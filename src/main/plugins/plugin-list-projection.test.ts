import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').slice('encrypted:'.length)
  }
}))
import { emptyPluginLockfile } from '../../shared/plugins/plugin-install-lockfile'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import type { InvalidDiscoveredPlugin, ValidDiscoveredPlugin } from './plugin-discovery'
import { getPluginsDataDir } from './plugin-discovery'
import { buildPluginList } from './plugin-list-projection'
import { writePluginSetting } from './plugin-settings-write'
import type { PluginService } from './plugin-service'

const manifest = pluginManifestSchema.parse({
  manifestVersion: 1,
  id: 'demo',
  publisher: 'orca-samples',
  name: 'Demo',
  version: '1.0.0',
  engines: { orca: '>=1.0.0' },
  pluginApi: 1,
  contributes: { panels: [], commands: [], events: [] },
  capabilities: [{ kind: 'workspace:read' }]
})

function serviceWith(
  discovered: ValidDiscoveredPlugin,
  options: {
    activation?: ReturnType<PluginService['activationState']>
    worker?: ReturnType<PluginService['workerState']>
    vmRecipes?: ReturnType<PluginService['contentPacks']['vmRecipes']['preview']>
    commands?: ReturnType<PluginService['contentPacks']['commands']['preview']>
    userDataPath?: string
  } = {}
): PluginService {
  return {
    options: {
      getPluginConsents: () => ({}),
      getDisabledPlugins: () => [],
      userDataPath: options.userDataPath ?? join(tmpdir(), 'orca-projection-no-settings')
    },
    getDiscovered: () => [discovered],
    activationState: () => options.activation ?? 'pending',
    workerState: () => options.worker ?? { state: 'inactive', restarts: 0 },
    activationError: () => null,
    contentPacks: {
      vmRecipes: { preview: () => options.vmRecipes ?? [] },
      commands: { preview: () => options.commands ?? [] }
    }
  } as unknown as PluginService
}

describe('buildPluginList consent identity', () => {
  it('projects the exact current fingerprint for an optimistic consent write', async () => {
    const plugin: ValidDiscoveredPlugin = {
      pluginKey: 'orca-samples.demo',
      rootDir: join(tmpdir(), 'plugins', 'demo'),
      manifest,
      consentFingerprint: 'sha256-current',
      contentHash: null,
      isDev: true
    }

    expect((await buildPluginList(serviceWith(plugin), emptyPluginLockfile()))[0]).toMatchObject({
      pluginKey: plugin.pluginKey,
      consentFingerprint: 'sha256-current',
      status: 'pending'
    })
  })

  it('projects supervised backoff as restarting instead of running', async () => {
    const plugin: ValidDiscoveredPlugin = {
      pluginKey: 'orca-samples.demo',
      rootDir: join(tmpdir(), 'plugins', 'demo'),
      manifest,
      consentFingerprint: 'sha256-current',
      contentHash: null,
      isDev: true
    }

    expect(
      (
        await buildPluginList(
          serviceWith(plugin, {
            activation: 'approved',
            worker: { state: 'restarting', restarts: 2 }
          }),
          emptyPluginLockfile()
        )
      )[0]
    ).toMatchObject({ status: 'restarting', restarts: 2 })
  })

  it('does not attribute a shadowing dev plugin to the installed source', async () => {
    const plugin: ValidDiscoveredPlugin = {
      pluginKey: 'orca-samples.demo',
      rootDir: join(tmpdir(), 'development', 'demo'),
      manifest,
      consentFingerprint: 'sha256-current',
      contentHash: null,
      isDev: true
    }
    const lock = {
      version: 1 as const,
      plugins: {
        [plugin.pluginKey]: {
          pluginKey: plugin.pluginKey,
          version: '1.0.0',
          source: { kind: 'git' as const, url: 'https://example.com/demo.git', ref: 'v1' },
          resolvedCommit: 'a'.repeat(40),
          contentHash: 'b'.repeat(64),
          consentFingerprint: 'sha256-installed',
          installedAt: 1
        }
      }
    }

    expect((await buildPluginList(serviceWith(plugin), lock))[0]).not.toHaveProperty('source')
  })

  it('does not expose an invalid development plugin absolute path as identity', async () => {
    const invalid: InvalidDiscoveredPlugin = {
      rootDir: join(tmpdir(), 'private', 'secret-plugin-path'),
      error: 'missing orca-plugin.json',
      isDev: true
    }
    const service = {
      options: { getPluginConsents: () => ({}), getDisabledPlugins: () => [] },
      getDiscovered: () => [invalid]
    } as unknown as PluginService

    const projected = (await buildPluginList(service, emptyPluginLockfile()))[0]!
    expect(projected.pluginKey).toBe('invalid-development-plugin-1')
    expect(projected.name).toBe('invalid-development-plugin-1')
    expect(JSON.stringify(projected)).not.toContain(invalid.rootDir)
  })

  it('projects exact VM lifecycle commands for instructional consent', async () => {
    const recipeManifest = pluginManifestSchema.parse({
      ...manifest,
      contributes: { vmRecipes: [{ path: 'recipes/cloud.json' }] }
    })
    const plugin: ValidDiscoveredPlugin = {
      pluginKey: 'orca-samples.demo',
      rootDir: join(tmpdir(), 'plugins', 'demo'),
      manifest: recipeManifest,
      consentFingerprint: 'sha256-current',
      consentContentHash: 'a'.repeat(64),
      contentHash: null,
      isDev: true
    }

    expect(
      (
        await buildPluginList(
          serviceWith(plugin, {
            vmRecipes: [
              {
                pluginKey: plugin.pluginKey,
                recipe: {
                  id: 'cloud',
                  name: 'Cloud',
                  create: './create.sh',
                  destroyDisabled: true
                }
              }
            ]
          }),
          emptyPluginLockfile()
        )
      )[0]?.vmRecipes
    ).toEqual([
      {
        id: 'cloud',
        name: 'Cloud',
        commands: [
          { phase: 'create', command: './create.sh' },
          { phase: 'destroy', command: 'none' }
        ]
      }
    ])
  })

  it('projects command handlers and normalized keybindings for consent and dispatch', async () => {
    const commandManifest = pluginManifestSchema.parse({
      ...manifest,
      contributes: {
        commands: [{ id: 'tasks', title: 'Open Tasks', context: 'worktree', action: 'view.tasks' }],
        keybindings: [{ command: 'tasks', key: 'mod+alt+t' }]
      }
    })
    const plugin: ValidDiscoveredPlugin = {
      pluginKey: 'orca-samples.demo',
      rootDir: join(tmpdir(), 'plugins', 'demo'),
      manifest: commandManifest,
      consentFingerprint: 'sha256-current',
      consentContentHash: 'a'.repeat(64),
      contentHash: null,
      isDev: true
    }

    expect(
      (
        await buildPluginList(
          serviceWith(plugin, {
            commands: [
              {
                pluginKey: plugin.pluginKey,
                id: 'tasks',
                title: 'Open Tasks',
                context: 'worktree',
                handler: { type: 'built-in', action: 'view.tasks' },
                keybindings: [{ key: 'Mod+Alt+T', when: 'worktree' }]
              }
            ]
          }),
          emptyPluginLockfile()
        )
      )[0]?.commands
    ).toEqual([
      {
        id: 'tasks',
        title: 'Open Tasks',
        context: 'worktree',
        handler: { type: 'built-in', action: 'view.tasks' },
        keybindings: [{ key: 'Mod+Alt+T', when: 'worktree' }]
      }
    ])
  })
})

describe('buildPluginList declared settings', () => {
  const settingsManifest = pluginManifestSchema.parse({
    manifestVersion: 1,
    id: 'webhook',
    publisher: 'orca-samples',
    name: 'Webhook',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: {
      settings: [{ key: 'webhookUrl', type: 'string', label: 'Webhook URL', required: true }]
    },
    capabilities: [{ kind: 'settings:own' }]
  })

  function discovered(manifest: typeof settingsManifest): ValidDiscoveredPlugin {
    return {
      pluginKey: 'orca-samples.webhook',
      rootDir: join(tmpdir(), 'plugins', 'webhook'),
      manifest,
      consentFingerprint: 'sha256-current',
      contentHash: null,
      isDev: false
    }
  }

  it('projects the declared settings and flags an unconfigured required key', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'orca-projection-settings-'))
    try {
      const service = serviceWith(discovered(settingsManifest), {
        activation: 'enabled',
        worker: { state: 'running', restarts: 0 },
        userDataPath
      })
      const entry = (await buildPluginList(service, emptyPluginLockfile()))[0]!

      expect(entry.needsSetup).toBe(true)
      expect(entry.settings).toEqual([
        {
          key: 'webhookUrl',
          type: 'string',
          label: 'Webhook URL',
          secret: false,
          required: true,
          configured: false
        }
      ])

      writePluginSetting({
        pluginsDataDir: getPluginsDataDir(userDataPath),
        pluginKey: 'orca-samples.webhook',
        declared: settingsManifest.contributes.settings,
        key: 'webhookUrl',
        value: 'https://hooks.example.test/abc'
      })
      const configured = (await buildPluginList(service, emptyPluginLockfile()))[0]!
      expect(configured.needsSetup).toBeUndefined()
      expect(configured.settings?.[0]?.value).toBe('https://hooks.example.test/abc')
    } finally {
      await rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('omits the settings block entirely when the manifest declares none', async () => {
    const entry = (
      await buildPluginList(serviceWith(discovered(manifest)), emptyPluginLockfile())
    )[0]!
    expect(entry).not.toHaveProperty('settings')
    expect(entry).not.toHaveProperty('needsSetup')
  })

  it('does not outrank a disabled plugin with a setup prompt', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'orca-projection-disabled-'))
    try {
      const entry = (
        await buildPluginList(
          serviceWith(discovered(settingsManifest), { activation: 'disabled', userDataPath }),
          emptyPluginLockfile()
        )
      )[0]!
      expect(entry.status).toBe('disabled')
      expect(entry.needsSetup).toBeUndefined()
      expect(entry.settings).toHaveLength(1)
    } finally {
      await rm(userDataPath, { recursive: true, force: true })
    }
  })
})
