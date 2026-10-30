import { parseGameActions, type OrchestratorGameAction } from './orchestrator-game-actions'
import {
  parseGameLead,
  resolveGameLead,
  type GameHostProfile,
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
  parseGameReviewsSource,
  parseGameTodoSource,
  type OrchestratorGameReviewsSource,
  type OrchestratorGameTodoSource
} from './orchestrator-game-project-work'
import {
  parseGameRewardWeights,
  resolveGameRewardWeights,
  type GameRewardWeights
} from './orchestrator-game-reward-weights'
import {
  isLookKey,
  lookFieldOf,
  ORCHESTRATOR_GAME_LOCAL_TIMEZONE,
  type OrchestratorGameRender
} from './orchestrator-game-render'
import {
  orchestratorGameSceneFileErrorText,
  orchestratorGameSceneFileId,
  parseOrchestratorGameSceneFile
} from './orchestrator-game-scene-file'

export type OrchestratorGameMode = 'on' | 'zen' | 'flat' | 'off'

// Why flat last but off: a mod older than flat reads it as unknown and keeps its launch mode.
export const ORCHESTRATOR_GAME_MODES: readonly OrchestratorGameMode[] = ['on', 'zen', 'flat', 'off']

/** Where the game's links open: Orca's own browser, or the system's where the person is signed in. */
export type OrchestratorGameOpenLinks = 'orca' | 'system'

export const ORCHESTRATOR_GAME_OPEN_LINKS: readonly OrchestratorGameOpenLinks[] = ['orca', 'system']

export type OrchestratorGameConfig = {
  mode: OrchestratorGameMode
  /** Show the game: false hides it and keeps `mode` as the default view for when it returns. */
  show: boolean
  scene: string
  hud: boolean
  rewards: boolean
  tracker: boolean
  openLinks: OrchestratorGameOpenLinks
  render: OrchestratorGameRender
  /** An IANA zone for the hd scene's day and night, or `local` for the machine's clock. */
  timezone: string
}

/** Lists that a later layer replaces whole; kept out of the config so Settings and the env stay scalar. */
export type OrchestratorGameIntegrations = {
  links: OrchestratorGameLinkTemplate[]
  activity: OrchestratorGameActivityRule[]
  /** Project buttons that send the lead a prompt or run an MCP tool. */
  actions: OrchestratorGameAction[]
  /** Where the band's To Do comes from; null picks it from the repo and its linked work item. */
  todo: OrchestratorGameTodoSource | null
  /** What the PR list's link does; a later layer replaces it whole. */
  reviews: OrchestratorGameReviewsSource
}

export type OrchestratorGameLayer = Partial<OrchestratorGameConfig> &
  Partial<Omit<OrchestratorGameIntegrations, 'todo' | 'reviews'>> & {
    reviews?: OrchestratorGameReviewsSource
    todo?: OrchestratorGameTodoSource
    /** How the lead orchestrates; merged key by key across layers. */
    orchestrator?: OrchestratorGameLeadLayer
    /** XP per reward; merged key by key across layers, 0 turns one off. */
    rewardWeights?: Partial<GameRewardWeights>
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
  show: true,
  scene: 'quest',
  hud: true,
  rewards: true,
  tracker: true,
  openLinks: 'orca',
  render: 'classic',
  timezone: ORCHESTRATOR_GAME_LOCAL_TIMEZONE
}

const KEYS = Object.keys(DEFAULT_ORCHESTRATOR_GAME_CONFIG) as (keyof OrchestratorGameConfig)[]

// Why: later layers win — the repo owner's orca.yaml over global Settings, the dev's local override over both.
export const ORCHESTRATOR_GAME_LAYER_ORDER: readonly Exclude<OrchestratorGameSource, 'default'>[] =
  ['global', 'project', 'local']

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
  for (const source of ORCHESTRATOR_GAME_LAYER_ORDER) {
    const layer = layers[source]
    if (!layer) {
      continue
    }
    for (const key of KEYS) {
      if (layer[key] === undefined) {
        continue
      }
      // Why: a hand-edited Settings value is not parsed on the way in, so it is checked here.
      const checked = isLookKey(key)
        ? lookFieldOf(key, layer[key])
        : { value: layer[key], warning: undefined }
      if (checked.warning !== undefined) {
        warnings.push(checked.warning)
        continue
      }
      Object.assign(config, { [key]: checked.value })
      sources[key] = source
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
    todo: null,
    reviews: {}
  }
  for (const source of ORCHESTRATOR_GAME_LAYER_ORDER) {
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
    if (layer?.reviews !== undefined) {
      resolved.reviews = parseGameReviewsSource(layer.reviews).value ?? {}
    }
    const todo = layer?.todo === undefined ? undefined : parseGameTodoSource(layer.todo).value
    if (todo !== undefined) {
      resolved.todo = todo
    }
  }
  return resolved
}

export function resolveOrchestratorGameLead(
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>,
  host: GameHostProfile | null = null
): OrchestratorGameLead {
  return resolveGameLead(
    ORCHESTRATOR_GAME_LAYER_ORDER.map((source) => layers[source]?.orchestrator),
    host
  )
}

export function resolveOrchestratorGameRewardWeights(
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>
): GameRewardWeights {
  return resolveGameRewardWeights(
    ORCHESTRATOR_GAME_LAYER_ORDER.map((source) => layers[source]?.rewardWeights)
  )
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
    } else if (key === 'openLinks') {
      if (value === 'orca' || value === 'system') {
        layer.openLinks = value
      } else {
        warnings.push('orchestratorGame.openLinks must be orca or system')
      }
    } else if (isLookKey(key)) {
      const checked = lookFieldOf(key, value)
      if (checked.warning === undefined) {
        Object.assign(layer, { [key]: checked.value })
      } else {
        warnings.push(checked.warning)
      }
    } else if (key === 'show' || key === 'hud' || key === 'rewards' || key === 'tracker') {
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
    } else if (key === 'rewardWeights') {
      const parsed = parseGameRewardWeights(value)
      warnings.push(...parsed.warnings)
      if (parsed.value) {
        layer.rewardWeights = parsed.value
      }
    } else if (key === 'reviews') {
      const parsed = parseGameReviewsSource(value)
      warnings.push(...parsed.warnings)
      if (parsed.value !== undefined) {
        layer.reviews = parsed.value
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
