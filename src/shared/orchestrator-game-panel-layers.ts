import {
  ORCHESTRATOR_GAME_LAYER_ORDER,
  resolveOrchestratorGameConfig,
  type OrchestratorGameLayer,
  type OrchestratorGameSource
} from './orchestrator-game-config'
import { resolveGamePanel, type OrchestratorGamePanel } from './orchestrator-game-panel'

/** The panel after global Settings, orca.yaml and this machine's layer; unset keys follow `mode`. */
export function resolveOrchestratorGamePanel(
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>
): OrchestratorGamePanel {
  return resolveGamePanel(
    ORCHESTRATOR_GAME_LAYER_ORDER.map((source) => layers[source]?.panel),
    resolveOrchestratorGameConfig(layers).config
  )
}
