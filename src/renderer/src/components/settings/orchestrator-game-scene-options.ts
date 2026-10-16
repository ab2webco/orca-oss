import type { PluginHostListEntry } from '../../../../preload/api/plugin-host-api'
import {
  ORCHESTRATOR_GAME_BUILT_IN_SCENES,
  type OrchestratorGameBuiltInScene
} from '../../../../shared/orchestrator-game-config'

export type OrchestratorGameSceneOption =
  | { value: string; kind: 'built-in'; scene: OrchestratorGameBuiltInScene }
  | { value: string; kind: 'plugin'; scene: string; pluginName: string }
  | { value: string; kind: 'missing'; scene: string }

const SERVING_STATUSES: readonly PluginHostListEntry['status'][] = ['running', 'restarting', 'idle']

/** Scene choices for Settings: the built-in scenes, then scenes of plugins the host runs, then the
 *  current id if nothing serves it (an orca.yaml value stays visible; the game falls back to quest). */
export function orchestratorGameSceneOptions(
  plugins: readonly PluginHostListEntry[],
  current: string | undefined
): OrchestratorGameSceneOption[] {
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
    ...ORCHESTRATOR_GAME_BUILT_IN_SCENES.map((scene) => ({
      value: scene,
      kind: 'built-in' as const,
      scene
    })),
    ...contributed
  ]
  if (current && !options.some((option) => option.value === current)) {
    options.push({ value: current, kind: 'missing', scene: current })
  }
  return options
}
