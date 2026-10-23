import {
  ORCHESTRATOR_GAME_LAYER_ORDER,
  resolveOrchestratorGameLead,
  type OrchestratorGameLayer,
  type OrchestratorGameSource
} from './orchestrator-game-config'
import { parseGameLead, type OrchestratorGameLead } from './orchestrator-game-lead'

/** The layer a lead key's effective value comes from; 'default' when no layer sets a usable one. */
export function gameLeadSourceOf(
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>,
  key: keyof OrchestratorGameLead
): OrchestratorGameSource {
  if (resolveOrchestratorGameLead(layers)[key] === undefined) {
    return 'default'
  }
  let source: OrchestratorGameSource = 'default'
  for (const name of ORCHESTRATOR_GAME_LAYER_ORDER) {
    const raw = layers[name]?.orchestrator
    if (raw !== undefined && parseGameLead(raw).value?.[key] !== undefined) {
      source = name
    }
  }
  return source
}
