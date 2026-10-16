export type GameMode = 'on' | 'zen' | 'off'

export type GameConfig = { mode: GameMode; scene: string; hud: boolean; rewards: boolean }

export type GameAgentState = 'working' | 'waiting' | 'idle' | 'done'

/** The newest id an agent's MCP calls mentioned that a rule turned into a link. */
export type GameActivity = { name: string; id: string; url: string; at: number; running: boolean }

export type GameAgent = {
  paneKey: string
  displayName: string
  agentType: string
  state: GameAgentState
  toolName: string | null
  isLeader: boolean
  /** Only a pane Orca maps to a live terminal has one; older hosts send none. */
  terminalHandle?: string
  /** Only an agent a project or built-in activity rule matched has one. */
  activity?: GameActivity
}

export type GameCi = 'pending' | 'success' | 'failure' | 'neutral' | 'none'

export type GameReview = {
  provider: 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'gitea'
  number: number
  title: string
  url: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  ci: GameCi
}

export type GameStatusGroup =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'cancelled'
  | 'unknown'

export type GameWorkItem = {
  provider: 'plane' | 'jira' | 'linear' | 'github' | 'gitlab'
  identifier: string
  title: string
  url: string
  status: string
  statusGroup: GameStatusGroup
}

export type GameLinkKind = 'review' | 'ci' | 'workItem' | 'project' | 'activity'

export type GameLinkTone = 'neutral' | 'pending' | 'success' | 'danger'

/** A clickable integration of the worktree; `url` is always http(s). */
export type GameLink = {
  id: string
  kind: GameLinkKind
  provider: string
  label: string
  url: string
  status?: string
  tone?: GameLinkTone
}

export type GameProjectItem = {
  id: string
  title: string
  url: string
  status?: string
  tone?: GameLinkTone
}

/** `total` counts every open item; `items` holds the first few and `url` opens the full list. */
export type GameProjectList = {
  provider: string
  total: number
  url: string | null
  items: GameProjectItem[]
}

/** My open PRs and tickets across the project, not only this worktree's. */
export type GameProjectWork = { reviews: GameProjectList | null; todo: GameProjectList | null }

export type GameWorktree = { id: string; path: string; branch: string; displayName: string }

export type GameLocale = 'en' | 'es' | 'ja' | 'ko' | 'zh'

/** A scene's card or teller name: one string, or one per language with English required. */
export type LocalizedName = string | ({ en: string } & Partial<Record<GameLocale, string>>)

export type FlowPhase = 'docs' | 'build' | 'verify' | 'pr' | 'handoff'

export type ScenePhase = FlowPhase | 'working'

export type PlantKind = 'tree' | 'cactus' | 'none' | 'antenna' | 'crystal' | 'flower'

// The far layer behind the hills; `peaks` when a look leaves it out.
export type Scenery = 'peaks' | 'skyline' | 'crystals' | 'meadow'

export type Look = {
  skyTop: number
  skyBottom: number
  sun: number
  isNight: boolean
  far: number
  snow: number
  near: number
  ground: number
  plant: number
  plantKind: PlantKind
  cloud: number
  scenery?: Scenery
  /** A searchlight sign in place of the sun, its beam slanting down. */
  isSignal?: boolean
}

// Ten columns wide; each glyph names a key of `colors`, '.' is transparent.
export type Costume = {
  rows: readonly string[]
  legs: readonly [string, string]
  colors: Readonly<Record<string, number>>
}

export type Card = { icon: string; name: LocalizedName; color: string }

export type BandPalette = { gold: string; ink: string; panel: string; parchment: string }

/** The team band's pixel-art frame and night sky; built-in scenes leave it out and keep Quest's. */
export type HudPalette = {
  skyTop: number
  skyBottom: number
  frame: number
  text: number
  dim: number
  star: number
}

export type SceneDefinition = {
  id: string
  looks: Readonly<Record<ScenePhase, Look>>
  costumes: Readonly<Record<ScenePhase, Costume>>
  cards: Readonly<Record<ScenePhase, Card>>
  teller: Card
  band: BandPalette
  /** Faces a teammate whose CI is red, on its tile and in turns with it on the HUD. */
  foe?: Costume
  /** Caption painted while a merge runs; pixel art, so width-1 characters only. */
  finale?: LocalizedName
  hud?: HudPalette
}

export type GameSceneExtension = { id: string; pluginId: string; definition: SceneDefinition }

export type GameState = {
  config: Partial<GameConfig>
  warnings: string[]
  worktree: GameWorktree | null
  agents: GameAgent[]
  review: GameReview | null
  workItem: GameWorkItem | null
  extensions: { scenes: GameSceneExtension[] }
  /** Empty from a host older than game links. */
  links: GameLink[]
  /** The calling pane's own activity. */
  activity: GameActivity | null
  /** Absent from a host older than project work or with the tracker off. */
  project?: GameProjectWork
}

export type FleetState = {
  isLoading: boolean
  refreshedAt: number
  state: GameState | null
  note: string
  xp: number
}

/** A line another plugin set with `$.ui.status`, held for the allies strip while the game draws. */
export type AllyStatus = { plugin: string; text: string }

export type AlliesState = { statuses: AllyStatus[] }

declare module 'claude-code' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- only an interface merges into the engine's
  interface PluginState {
    'orca-game': { fleet: FleetState; allies: AlliesState }
    // Read, never depended on: hooks/allies.ts checks the shape at runtime.
    'orca-jev-mod-skills': { advisor: unknown }
  }
}
