import {
  coercePluginSettingWrite,
  isSecretPluginSetting,
  type PluginSettingContribution
} from '../../shared/plugins/plugin-settings-contribution'
import { PluginKvStore } from './plugin-storage-store'
import { PluginSecretsStore } from './plugin-secrets-store'

export type PluginSettingWriteResult = { ok: true } | { ok: false; error: string }

/**
 * Writes one declared setting through the store its declaration names. The
 * manifest is the allowlist: an undeclared key never reaches disk, so the
 * renderer cannot use this path to write arbitrary plugin storage.
 */
export function writePluginSetting(args: {
  pluginsDataDir: string
  pluginKey: string
  declared: readonly PluginSettingContribution[]
  key: string
  value: unknown
}): PluginSettingWriteResult {
  const setting = args.declared.find((candidate) => candidate.key === args.key)
  if (!setting) {
    return { ok: false, error: `plugin ${args.pluginKey} does not declare setting ${args.key}` }
  }
  const coerced = coercePluginSettingWrite(setting, args.value)
  if (!coerced.ok) {
    return coerced
  }
  if (isSecretPluginSetting(setting)) {
    const vault = new PluginSecretsStore(args.pluginsDataDir, args.pluginKey)
    if (coerced.value === '') {
      // Clearing a secret must remove it, not store an empty ciphertext.
      vault.delete(setting.key)
      return { ok: true }
    }
    const stored = vault.set(setting.key, String(coerced.value))
    return stored.ok ? { ok: true } : { ok: false, error: stored.error }
  }
  return new PluginKvStore(args.pluginsDataDir, args.pluginKey, 'settings.json').set(
    setting.key,
    coerced.value
  )
}
