import {
  parseGameActivityRules,
  parseGameLinkTemplates,
  type OrchestratorGameActivityRule,
  type OrchestratorGameLinkTemplate
} from './orchestrator-game-integrations'

export type OrchestratorGameMode = 'on' | 'zen' | 'off'

export const ORCHESTRATOR_GAME_MODES: readonly OrchestratorGameMode[] = ['on', 'zen', 'off']

export type OrchestratorGameConfig = {
  mode: OrchestratorGameMode
  scene: string
  hud: boolean
  rewards: boolean
  tracker: boolean
}

/** Lists that a later layer replaces whole; kept out of the config so Settings and the env stay scalar. */
export type OrchestratorGameIntegrations = {
  links: OrchestratorGameLinkTemplate[]
  activity: OrchestratorGameActivityRule[]
}

export type OrchestratorGameLayer = Partial<OrchestratorGameConfig> &
  Partial<OrchestratorGameIntegrations>

export type OrchestratorGameSource = 'default' | 'global' | 'project' | 'local'

export type ResolvedOrchestratorGameConfig = {
  config: OrchestratorGameConfig
  sources: Record<keyof OrchestratorGameConfig, OrchestratorGameSource>
}

// Why listed here: the bundled mod ships these art sets, so Settings offers them without a plugin.
export const ORCHESTRATOR_GAME_BUILT_IN_SCENES = ['quest', 'vigilante', 'jrpg', 'tamer'] as const

export type OrchestratorGameBuiltInScene = (typeof ORCHESTRATOR_GAME_BUILT_IN_SCENES)[number]

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

// Why: Settings layers are plain JSON a user can hand-edit, so every layer is re-validated, not only orca.yaml.
export function resolveOrchestratorGameIntegrations(
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>
): OrchestratorGameIntegrations {
  const resolved: OrchestratorGameIntegrations = { links: [], activity: [] }
  for (const source of LAYER_ORDER) {
    const layer = layers[source]
    if (layer?.links !== undefined) {
      resolved.links = parseGameLinkTemplates(layer.links).value ?? []
    }
    if (layer?.activity !== undefined) {
      resolved.activity = parseGameActivityRules(layer.activity).value ?? []
    }
  }
  return resolved
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
    } else if (key === 'links' || key === 'activity') {
      const parsed = key === 'links' ? parseGameLinkTemplates(value) : parseGameActivityRules(value)
      warnings.push(...parsed.warnings)
      if (parsed.value) {
        Object.assign(layer, { [key]: parsed.value })
      }
    } else {
      warnings.push(`orchestratorGame.${key} is not a known setting`)
    }
  }
  return { layer, warnings }
}
