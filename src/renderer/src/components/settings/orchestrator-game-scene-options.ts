import type { PluginHostListEntry } from '../../../../preload/api/plugin-host-api'
import { DEFAULT_ORCHESTRATOR_GAME_CONFIG } from '../../../../shared/orchestrator-game-config'

export type OrchestratorGameSceneOption =
  | { value: string; kind: 'built-in'; scene: string }
  | { value: string; kind: 'plugin'; scene: string; pluginName: string }
  | { value: string; kind: 'missing'; scene: string }

const SERVING_STATUSES: readonly PluginHostListEntry['status'][] = ['running', 'restarting', 'idle']

/** Scene choices for Settings: quest, then scenes of plugins the host runs, then the current id if
 *  nothing installed serves it (an orca.yaml value stays visible; the game falls back to quest). */
export function orchestratorGameSceneOptions(
  plugins: readonly PluginHostListEntry[],
  current: string | undefined
): OrchestratorGameSceneOption[] {
  const builtIn = DEFAULT_ORCHESTRATOR_GAME_CONFIG.scene
  const contributed = plugins
    .filter((plugin) => SERVING_STATUSES.includes(plugin.status) && !plugin.blockedByKillList)
    .flatMap((plugin) =>
      (plugin.gameScenes ?? []).map((value) => ({
        value,
        kind: 'plugin' as const,
        scene: value.slice(plugin.pluginKey.length + 1),
        pluginName: plugin.name
      }))
    )
    .sort((a, b) => a.pluginName.localeCompare(b.pluginName) || a.scene.localeCompare(b.scene))
  const options: OrchestratorGameSceneOption[] = [
    { value: builtIn, kind: 'built-in', scene: builtIn },
    ...contributed
  ]
  if (current && !options.some((option) => option.value === current)) {
    options.push({ value: current, kind: 'missing', scene: current })
  }
  return options
}
