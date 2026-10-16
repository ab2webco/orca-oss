import { parseGameActions, type OrchestratorGameAction } from './orchestrator-game-actions'
import {
  parseGameLead,
  resolveGameLead,
  type OrchestratorGameLead,
  type OrchestratorGameLeadLayer
} from './orchestrator-game-lead'
import {
  parseGameActivityRules,
  parseGameLinkTemplates,
  type OrchestratorGameActivityRule,
  type OrchestratorGameLinkTemplate
} from './orchestrator-game-integrations'
import {
  parseGameTodoSource,
  type OrchestratorGameTodoSource
} from './orchestrator-game-project-work'
import {
  orchestratorGameSceneFileErrorText,
  orchestratorGameSceneFileId,
  parseOrchestratorGameSceneFile
} from './orchestrator-game-scene-file'

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
  /** Project buttons that send the lead a prompt or run an MCP tool. */
  actions: OrchestratorGameAction[]
  /** Where the band's To Do comes from; null picks it from the repo and its linked work item. */
  todo: OrchestratorGameTodoSource | null
}

export type OrchestratorGameLayer = Partial<OrchestratorGameConfig> &
  Partial<Omit<OrchestratorGameIntegrations, 'todo'>> & {
    todo?: OrchestratorGameTodoSource
    /** How the lead orchestrates; merged key by key across layers. */
    orchestrator?: OrchestratorGameLeadLayer
    /** A scene JSON relative to the worktree root; read only from the project layers. */
    sceneFile?: string
  }

export type OrchestratorGameSource = 'default' | 'global' | 'project' | 'local'

export type ResolvedOrchestratorGameConfig = {
  config: OrchestratorGameConfig
  sources: Record<keyof OrchestratorGameConfig, OrchestratorGameSource>
  /** The worktree path the effective scene is read from, when a scene file won over `scene`. */
  sceneFile: string | null
  warnings: string[]
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
  let sceneFile: string | null = null
  const warnings: string[] = []
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
    if (layer.scene !== undefined) {
      sceneFile = null
    }
    if (layer.sceneFile === undefined) {
      continue
    }
    // Why: a path means a worktree, which only a project has; a global one would follow every repo.
    if (source === 'global') {
      warnings.push(
        'orchestratorGame.sceneFile is read only from orca.yaml or the project Settings'
      )
      continue
    }
    const parsed = parseOrchestratorGameSceneFile(layer.sceneFile)
    if (!parsed.ok) {
      warnings.push(
        `orchestratorGame.sceneFile ${orchestratorGameSceneFileErrorText(parsed.error)}`
      )
      continue
    }
    sceneFile = parsed.path
    config.scene = orchestratorGameSceneFileId(parsed.path)
    sources.scene = source
  }
  return { config, sources, sceneFile, warnings }
}

// Why: Settings layers are plain JSON a user can hand-edit, so every layer is re-validated, not only orca.yaml.
export function resolveOrchestratorGameIntegrations(
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>
): OrchestratorGameIntegrations {
  const resolved: OrchestratorGameIntegrations = {
    links: [],
    activity: [],
    actions: [],
    todo: null
  }
  for (const source of LAYER_ORDER) {
    const layer = layers[source]
    if (layer?.links !== undefined) {
      resolved.links = parseGameLinkTemplates(layer.links).value ?? []
    }
    if (layer?.activity !== undefined) {
      resolved.activity = parseGameActivityRules(layer.activity).value ?? []
    }
    if (layer?.actions !== undefined) {
      resolved.actions = parseGameActions(layer.actions).value ?? []
    }
    const todo = layer?.todo === undefined ? undefined : parseGameTodoSource(layer.todo).value
    if (todo !== undefined) {
      resolved.todo = todo
    }
  }
  return resolved
}

export function resolveOrchestratorGameLead(
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>
): OrchestratorGameLead {
  return resolveGameLead(LAYER_ORDER.map((source) => layers[source]?.orchestrator))
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
    } else if (key === 'sceneFile') {
      const parsed = parseOrchestratorGameSceneFile(value)
      if (parsed.ok) {
        layer.sceneFile = parsed.path
      } else {
        warnings.push(
          `orchestratorGame.sceneFile ${orchestratorGameSceneFileErrorText(parsed.error)}`
        )
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
    } else if (key === 'actions') {
      const parsed = parseGameActions(value)
      warnings.push(...parsed.warnings)
      if (parsed.value) {
        layer.actions = parsed.value
      }
    } else if (key === 'orchestrator') {
      const parsed = parseGameLead(value)
      warnings.push(...parsed.warnings)
      if (parsed.value) {
        layer.orchestrator = parsed.value
      }
    } else if (key === 'todo') {
      const parsed = parseGameTodoSource(value)
      warnings.push(...parsed.warnings)
      if (parsed.value !== undefined) {
        layer.todo = parsed.value
      }
    } else {
      warnings.push(`orchestratorGame.${key} is not a known setting`)
    }
  }
  return { layer, warnings }
}
