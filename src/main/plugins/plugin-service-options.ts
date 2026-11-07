import type { PluginWorkerFactory } from './plugin-worker-manager'
import type { KeybindingOverrides } from '../../shared/keybindings'
import type { PluginKillListEntry } from '../../shared/plugins/plugin-kill-list'

export type PluginServiceOptions = {
  userDataPath: string
  hostVersion: string
  isPluginSystemEnabled: () => boolean
  getDisabledPlugins: () => string[]
  getPluginConsents: () => Record<string, string>
  getDevPluginPaths: () => string[]
  getTrustedDevPluginPaths?: () => string[]
  getKeybindings?: () => KeybindingOverrides
  getPluginKillListEntry?: (pluginKey: string) => PluginKillListEntry | null
  /** A reason blocks every plugin that can spawn processes (dev profile on a linked vault, ORCA-1131). */
  getSpawnCapableWorkerBlockReason?: () => string | null
  hostEntryPath?: string
  workerFactory?: PluginWorkerFactory
  maxActiveWorkers?: number
  idleReapMs?: number
}
