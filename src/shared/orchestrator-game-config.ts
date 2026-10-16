export type OrchestratorGameMode = 'on' | 'zen' | 'off'

export const ORCHESTRATOR_GAME_MODES: readonly OrchestratorGameMode[] = ['on', 'zen', 'off']

export type OrchestratorGameConfig = {
  mode: OrchestratorGameMode
  scene: string
  hud: boolean
  rewards: boolean
  tracker: boolean
}

export type OrchestratorGameLayer = Partial<OrchestratorGameConfig>

export type OrchestratorGameSource = 'default' | 'global' | 'project' | 'local'

export type ResolvedOrchestratorGameConfig = {
  config: OrchestratorGameConfig
  sources: Record<keyof OrchestratorGameConfig, OrchestratorGameSource>
}

export const DEFAULT_ORCHESTRATOR_GAME_CONFIG: OrchestratorGameConfig = {
  mode: 'on',
  scene: 'quest',
  hud: true,
  rewards: true,
  tracker: true
}

const KEYS = Object.keys(DEFAULT_ORCHESTRATOR_GAME_CONFIG) as (keyof OrchestratorGameConfig)[]

// Why: later layers win — the repo owner's orca.yaml over global Settings, the dev's local override over both.
const LAYER_ORDER: readonly Exclude<OrchestratorGameSource, 'default'>[] = [
  'global',
  'project',
  'local'
]

export function resolveOrchestratorGameConfig(
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>
): ResolvedOrchestratorGameConfig {
  const config = { ...DEFAULT_ORCHESTRATOR_GAME_CONFIG }
  const sources = Object.fromEntries(KEYS.map((key) => [key, 'default'])) as Record<
    keyof OrchestratorGameConfig,
    OrchestratorGameSource
  >
  for (const source of LAYER_ORDER) {
    const layer = layers[source]
    if (!layer) {
      continue
    }
    for (const key of KEYS) {
      if (layer[key] !== undefined) {
        Object.assign(config, { [key]: layer[key] })
        sources[key] = source
      }
    }
  }
  return { config, sources }
}

const isMode = (value: unknown): value is OrchestratorGameMode =>
  typeof value === 'string' && (ORCHESTRATOR_GAME_MODES as readonly string[]).includes(value)

export function parseOrchestratorGameLayer(raw: unknown): {
  layer: OrchestratorGameLayer
  warnings: string[]
} {
  if (raw === undefined || raw === null) {
    return { layer: {}, warnings: [] }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { layer: {}, warnings: ['orchestratorGame must be a mapping'] }
  }
  const layer: OrchestratorGameLayer = {}
  const warnings: string[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'mode') {
      if (isMode(value)) {
        layer.mode = value
      } else {
        warnings.push(`orchestratorGame.mode must be one of ${ORCHESTRATOR_GAME_MODES.join(', ')}`)
      }
    } else if (key === 'scene') {
      if (typeof value === 'string' && value.trim() !== '') {
        layer.scene = value.trim()
      } else {
        warnings.push('orchestratorGame.scene must be a non-empty scene id')
      }
    } else if (key === 'hud' || key === 'rewards' || key === 'tracker') {
      if (typeof value === 'boolean') {
        layer[key] = value
      } else {
        warnings.push(`orchestratorGame.${key} must be true or false`)
      }
    } else {
      warnings.push(`orchestratorGame.${key} is not a known setting`)
    }
  }
  return { layer, warnings }
}
