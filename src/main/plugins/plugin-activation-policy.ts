import {
  getPluginActivationState,
  type PluginConsentLists
} from '../../shared/plugins/plugin-consent-state'
import type { ValidDiscoveredPlugin } from './plugin-discovery'

export function snapshotPluginConsentLists(source: {
  getPluginConsents: () => Record<string, string>
  getDisabledPlugins: () => string[]
}): PluginConsentLists {
  return {
    pluginConsents: source.getPluginConsents(),
    disabledPlugins: source.getDisabledPlugins()
  }
}

export type PluginRefreshInputs = {
  enabled: boolean
  devPaths: string[]
  consentLists: PluginConsentLists
}

export function snapshotPluginRefreshInputs(source: {
  isPluginSystemEnabled: () => boolean
  getDevPluginPaths: () => string[]
  getPluginConsents: () => Record<string, string>
  getDisabledPlugins: () => string[]
}): PluginRefreshInputs {
  return {
    enabled: source.isPluginSystemEnabled(),
    devPaths: source.getDevPluginPaths(),
    consentLists: snapshotPluginConsentLists(source)
  }
}

export function isPluginApproved(
  enabled: boolean,
  plugin: ValidDiscoveredPlugin,
  lists: PluginConsentLists
): boolean {
  return (
    enabled &&
    getPluginActivationState(plugin.pluginKey, plugin.consentFingerprint, lists) === 'approved'
  )
}
