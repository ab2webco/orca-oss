import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'
import {
  ORCHESTRATOR_GAME_SCENE_MAX_BYTES,
  type OrchestratorGameSceneSource
} from '../../shared/orchestrator-game-scene'
import { readContainedPluginArtifactText } from './plugin-artifact-validation'
import { isInvalidDiscoveredPlugin, type DiscoveredPlugin } from './plugin-discovery'

/** Game scenes an installed, approved plugin contributes; read on each `game.state` call. */

export type PluginGameSceneContribution = {
  pluginKey: string
  rootDir: string
  id: string
  path: string
}

/** Structural view of `PluginService`, so this stays testable without one. */
export type PluginGameSceneGrantSource = {
  getDiscovered: () => readonly DiscoveredPlugin[]
  getGrantedCapabilities: (pluginKey: string) => readonly PluginCapabilityKind[] | null
}

export function collectPluginGameSceneContributions(
  source: PluginGameSceneGrantSource
): PluginGameSceneContribution[] {
  const contributions: PluginGameSceneContribution[] = []
  for (const plugin of source.getDiscovered()) {
    if (isInvalidDiscoveredPlugin(plugin) || plugin.manifest.contributes.gameScenes.length === 0) {
      continue
    }
    // Why: null means disabled, unconsented, kill-listed or failed to activate; any of those serves nothing.
    if (source.getGrantedCapabilities(plugin.pluginKey) === null) {
      continue
    }
    for (const scene of plugin.manifest.contributes.gameScenes) {
      contributions.push({
        pluginKey: plugin.pluginKey,
        rootDir: plugin.rootDir,
        id: scene.id,
        path: scene.path
      })
    }
  }
  return contributions
}

let contributionProvider: (() => readonly PluginGameSceneContribution[]) | null = null

/** Injected once at the composition root; null on shutdown and in tests. */
export function setPluginGameSceneContributionProvider(
  provider: (() => readonly PluginGameSceneContribution[]) | null
): void {
  contributionProvider = provider
}

export async function readPluginGameSceneSources(
  contributions: readonly PluginGameSceneContribution[] = contributionProvider?.() ?? []
): Promise<OrchestratorGameSceneSource[]> {
  return Promise.all(
    contributions.map(async ({ pluginKey, rootDir, id, path }) => {
      try {
        const text = await readContainedPluginArtifactText(
          rootDir,
          path,
          ORCHESTRATOR_GAME_SCENE_MAX_BYTES
        )
        return { pluginId: pluginKey, id, text }
      } catch (error) {
        return { pluginId: pluginKey, id, error: sceneReadErrorOf(error) }
      }
    })
  )
}

// Why: `game.state` can reach a remote client, so an fs error keeps its code and drops the install path.
function sceneReadErrorOf(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return error instanceof Error ? error.message : String(error)
}
