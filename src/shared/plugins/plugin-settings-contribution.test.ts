import { describe, expect, it } from 'vitest'
import { pluginManifestSchema } from './plugin-manifest'
import {
  isPluginSettingConfigured,
  listUnconfiguredPluginSettings,
  pluginSettingsContributionSchema,
  type PluginSettingContribution
} from './plugin-settings-contribution'

function manifestWith(
  settings: unknown[],
  capabilities: { kind: string }[] = [{ kind: 'settings:own' }]
): unknown {
  return {
    manifestVersion: 1,
    id: 'demo',
    publisher: 'orca-samples',
    name: 'Demo',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { settings },
    capabilities
  }
}

const webhookUrl = {
  key: 'webhookUrl',
  type: 'string',
  label: 'Webhook URL',
  required: true
} as const

describe('contributes.settings manifest gate', () => {
  it('parses declared settings and defaults to an empty list', () => {
    const parsed = pluginManifestSchema.parse(manifestWith([webhookUrl]))
    expect(parsed.contributes.settings).toEqual([webhookUrl])
    expect(pluginManifestSchema.parse(manifestWith([])).contributes.settings).toEqual([])
  })

  it('requires settings:own before a plugin may declare settings', () => {
    expect(() => pluginManifestSchema.parse(manifestWith([webhookUrl], []))).toThrow(
      /settings:own capability required/
    )
  })

  it('requires the secrets capability for a secret-marked setting', () => {
    const secretToken = { key: 'token', type: 'string', label: 'Token', secret: true }
    expect(() => pluginManifestSchema.parse(manifestWith([secretToken]))).toThrow(
      /secrets capability required/
    )
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith([secretToken], [{ kind: 'settings:own' }, { kind: 'secrets' }])
      )
    ).not.toThrow()
  })

  it('rejects duplicate keys and a required setting that ships a default', () => {
    expect(() =>
      pluginSettingsContributionSchema.parse([
        { key: 'a', type: 'string', label: 'A' },
        { key: 'a', type: 'boolean', label: 'A again' }
      ])
    ).toThrow(/duplicate setting key: a/)
    expect(() =>
      pluginSettingsContributionSchema.parse([
        { key: 'a', type: 'string', label: 'A', required: true, default: 'x' }
      ])
    ).toThrow(/required setting cannot declare a default/)
  })
})

describe('unconfigured settings', () => {
  const declared: PluginSettingContribution[] = [
    webhookUrl,
    { key: 'token', type: 'string', label: 'Token', secret: true, required: true },
    { key: 'retries', type: 'number', label: 'Retries', default: 3 },
    { key: 'verbose', type: 'boolean', label: 'Verbose', default: false }
  ]

  it('treats a blank string as unconfigured, which is the state the webhook plugin sat in', () => {
    expect(listUnconfiguredPluginSettings(declared, { webhookUrl: '   ' }, ['token'])).toEqual([
      'webhookUrl'
    ])
    expect(
      listUnconfiguredPluginSettings(declared, { webhookUrl: 'https://example.test/hook' }, [
        'token'
      ])
    ).toEqual([])
  })

  it('counts a secret as configured only when the vault holds the key', () => {
    expect(listUnconfiguredPluginSettings(declared, { webhookUrl: 'https://x.test' }, [])).toEqual([
      'token'
    ])
  })

  it('treats a declared default as an effective value, and false as a real one', () => {
    expect(isPluginSettingConfigured(declared[2]!, undefined, false)).toBe(true)
    expect(isPluginSettingConfigured(declared[3]!, false, false)).toBe(true)
  })
})
