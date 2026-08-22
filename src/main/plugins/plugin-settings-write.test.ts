import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').slice('encrypted:'.length)
  }
}))

import type { PluginSettingContribution } from '../../shared/plugins/plugin-settings-contribution'
import { bindPluginHostServices } from './plugin-host-service-bindings'
import { projectPluginSettings } from './plugin-settings-values'
import { writePluginSetting } from './plugin-settings-write'

const PLUGIN_KEY = 'orca-samples.webhook'

const declared: PluginSettingContribution[] = [
  { key: 'webhookUrl', type: 'string', label: 'Webhook URL', required: true },
  { key: 'token', type: 'string', label: 'Token', secret: true, required: true },
  { key: 'retries', type: 'number', label: 'Retries', min: 0, max: 10, default: 3 },
  { key: 'verbose', type: 'boolean', label: 'Verbose', default: false }
]

const roots: string[] = []

async function tempDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-settings-'))
  roots.push(root)
  return root
}

/** The exact binding `settings.get` / `secrets.get` run for a plugin worker. */
function hostServices(pluginsDataDir: string): ReturnType<typeof bindPluginHostServices> {
  return bindPluginHostServices({
    pluginsDataDir,
    delegate: {
      resolveActiveWorktreeContext: vi.fn(),
      listTerminals: vi.fn(),
      sendTerminal: vi.fn(),
      dispatchPluginNotification: vi.fn()
    } as unknown as Parameters<typeof bindPluginHostServices>[0]['delegate'],
    subscribeEvents: () => []
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('writePluginSetting', () => {
  it('makes the value readable through the settings:own path the plugin already uses', async () => {
    const dataDir = await tempDataDir()
    const write = writePluginSetting({
      pluginsDataDir: dataDir,
      pluginKey: PLUGIN_KEY,
      declared,
      key: 'webhookUrl',
      value: 'https://hooks.example.test/abc'
    })

    expect(write).toEqual({ ok: true })
    expect(hostServices(dataDir).settings.getAll(PLUGIN_KEY)).toEqual({
      webhookUrl: 'https://hooks.example.test/abc'
    })
  })

  it('keeps a secret out of plaintext settings.json and readable from the vault', async () => {
    const dataDir = await tempDataDir()
    const write = writePluginSetting({
      pluginsDataDir: dataDir,
      pluginKey: PLUGIN_KEY,
      declared,
      key: 'token',
      value: 'sk-do-not-log-me'
    })

    expect(write).toEqual({ ok: true })
    const plaintext = await readFile(join(dataDir, PLUGIN_KEY, 'settings.json'), 'utf8').catch(
      () => ''
    )
    expect(plaintext).not.toContain('sk-do-not-log-me')
    expect(hostServices(dataDir).secrets.get(PLUGIN_KEY, 'token')).toEqual({
      ok: true,
      value: 'sk-do-not-log-me'
    })
  })

  it('clears a secret rather than storing an empty ciphertext', async () => {
    const dataDir = await tempDataDir()
    writePluginSetting({
      pluginsDataDir: dataDir,
      pluginKey: PLUGIN_KEY,
      declared,
      key: 'token',
      value: 'sk-live'
    })

    expect(
      writePluginSetting({
        pluginsDataDir: dataDir,
        pluginKey: PLUGIN_KEY,
        declared,
        key: 'token',
        value: ''
      })
    ).toEqual({ ok: true })
    expect(hostServices(dataDir).secrets.get(PLUGIN_KEY, 'token')).toEqual({
      ok: true,
      value: null
    })
  })

  it('refuses a key the manifest never declared and a value of the wrong type', async () => {
    const dataDir = await tempDataDir()
    expect(
      writePluginSetting({
        pluginsDataDir: dataDir,
        pluginKey: PLUGIN_KEY,
        declared,
        key: 'apiKeyOfSomeOtherPlugin',
        value: 'x'
      })
    ).toEqual({ ok: false, error: expect.stringContaining('does not declare setting') })
    expect(
      writePluginSetting({
        pluginsDataDir: dataDir,
        pluginKey: PLUGIN_KEY,
        declared,
        key: 'retries',
        value: 99
      })
    ).toEqual({ ok: false, error: expect.stringContaining('at most 10') })
    expect(hostServices(dataDir).settings.getAll(PLUGIN_KEY)).toEqual({})
  })
})

describe('projectPluginSettings', () => {
  it('reports needs-setup until every required setting has a value', async () => {
    const dataDir = await tempDataDir()
    expect(projectPluginSettings(dataDir, PLUGIN_KEY, declared).unconfigured).toEqual([
      'webhookUrl',
      'token'
    ])

    writePluginSetting({
      pluginsDataDir: dataDir,
      pluginKey: PLUGIN_KEY,
      declared,
      key: 'webhookUrl',
      value: 'https://hooks.example.test/abc'
    })
    writePluginSetting({
      pluginsDataDir: dataDir,
      pluginKey: PLUGIN_KEY,
      declared,
      key: 'token',
      value: 'sk-live'
    })

    const projected = projectPluginSettings(dataDir, PLUGIN_KEY, declared)
    expect(projected.unconfigured).toEqual([])
    // The secret is configured but its value never crosses the wire.
    expect(projected.settings.find((setting) => setting.key === 'token')).toEqual({
      key: 'token',
      type: 'string',
      label: 'Token',
      secret: true,
      required: true,
      configured: true
    })
    expect(projected.settings.find((setting) => setting.key === 'retries')?.value).toBe(3)
  })

  it('projects nothing when the manifest declares no settings', async () => {
    const dataDir = await tempDataDir()
    expect(projectPluginSettings(dataDir, PLUGIN_KEY, [])).toEqual({
      settings: [],
      unconfigured: []
    })
  })
})
