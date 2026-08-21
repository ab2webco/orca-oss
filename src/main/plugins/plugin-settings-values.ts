import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  effectivePluginSettingValue,
  isPluginSettingConfigured,
  isSecretPluginSetting,
  listUnconfiguredPluginSettings,
  type PluginSettingContribution,
  type PluginSettingType,
  type PluginSettingValue
} from '../../shared/plugins/plugin-settings-contribution'
import { PLUGIN_STORAGE_TOTAL_MAX_BYTES } from '../../shared/plugins/plugin-host-api'
import { PluginKvStore, pluginDataDir } from './plugin-storage-store'

/** Projected per declared setting. Secrets carry `configured`, never a value. */
export type PluginSettingProjection = {
  key: string
  type: PluginSettingType
  label: string
  description?: string
  secret: boolean
  required: boolean
  placeholder?: string
  min?: number
  max?: number
  value?: PluginSettingValue
  configured: boolean
}

type SecretsEnvelope = { version: 1; format: 'electron-safe-storage-v1'; ciphertexts: object }

/**
 * Which secrets exist, read straight off the vault envelope. Presence needs no
 * decryption, and going through PluginSecretsStore would drag `electron` into
 * the list projection, which also serves the headless `orca serve` RPC.
 */
export function readPluginSecretKeys(pluginsDataDir: string, pluginKey: string): string[] {
  try {
    const filePath = join(pluginDataDir(pluginsDataDir, pluginKey), 'secrets.json.enc')
    if (!existsSync(filePath) || statSync(filePath).size > PLUGIN_STORAGE_TOTAL_MAX_BYTES) {
      return []
    }
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as SecretsEnvelope
    if (parsed?.version !== 1 || parsed.format !== 'electron-safe-storage-v1') {
      return []
    }
    const { ciphertexts } = parsed
    return ciphertexts && typeof ciphertexts === 'object' && !Array.isArray(ciphertexts)
      ? Object.keys(ciphertexts)
      : []
  } catch {
    return []
  }
}

export function projectPluginSettings(
  pluginsDataDir: string,
  pluginKey: string,
  declared: readonly PluginSettingContribution[]
): { settings: PluginSettingProjection[]; unconfigured: string[] } {
  if (declared.length === 0) {
    return { settings: [], unconfigured: [] }
  }
  const stored = new PluginKvStore(pluginsDataDir, pluginKey, 'settings.json').getAll()
  const secretKeys = new Set(readPluginSecretKeys(pluginsDataDir, pluginKey))
  const settings = declared.map((setting): PluginSettingProjection => {
    const secret = isSecretPluginSetting(setting)
    const value = secret ? undefined : effectivePluginSettingValue(setting, stored[setting.key])
    return {
      key: setting.key,
      type: setting.type,
      label: setting.label,
      ...(setting.description ? { description: setting.description } : {}),
      secret,
      required: setting.required === true,
      ...(setting.type === 'string' && setting.placeholder
        ? { placeholder: setting.placeholder }
        : {}),
      ...(setting.type === 'number' && setting.min !== undefined ? { min: setting.min } : {}),
      ...(setting.type === 'number' && setting.max !== undefined ? { max: setting.max } : {}),
      ...(value === undefined ? {} : { value }),
      configured: isPluginSettingConfigured(
        setting,
        stored[setting.key],
        secretKeys.has(setting.key)
      )
    }
  })
  return {
    settings,
    unconfigured: listUnconfiguredPluginSettings(declared, stored, [...secretKeys])
  }
}
