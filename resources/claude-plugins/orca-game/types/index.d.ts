export type GameMode = 'on' | 'zen' | 'off'

/** `openLinks` is where links open: an Orca tab, or the system browser through Orca. */
export type GameConfig = {
  mode: GameMode
  scene: string
  hud: boolean
  rewards: boolean
  openLinks: 'orca' | 'system'
}

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
  /** A session the lead launched, which reports to it; false for the lead and its teammates. */
  isMember?: boolean
  /** The member's own worktree, when it is not the lead's. */
  worktree?: GameMemberWorktree
  /** The member worktree's own review and ticket. */
  review?: GameReview
  workItem?: GameWorkItem
  /** Set while a member is stopped by its account's usage limit; `resetsAt` is Unix ms. */
  limit?: GameMemberLimit
  /** The managed account a member's agent runs on; absent when Orca's own selection applies. */
  account?: GameMemberAccount
}

export type GameMemberLimit = { resetsAt: number | null }

export type GameMemberAccount = { provider: 'claude' | 'codex'; id: string; email: string }

export type GameMemberWorktree = { id: string; branch: string; displayName: string }

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
  /** A ticket's status group; an issue list from GitHub or GitLab has none. */
  group?: GameStatusGroup
  /** What "work on" sends the lead for this ticket. */
  prompt?: string
}

/** `total` counts every open item; `items` holds the first few and `url` opens the full list. */
export type GameProjectList = {
  provider: string
  total: number
  url: string | null
  items: GameProjectItem[]
  /** Open tickets per status group, all of them and not only `items`. */
  groups?: Partial<Record<GameStatusGroup, number>>
  /** The action (an id in `actions`) the To Do link runs instead of opening `url`. */
  actionId?: string
}

/** My open PRs and tickets across the project, not only this worktree's. */
export type GameProjectWork = { reviews: GameProjectList | null; todo: GameProjectList | null }

export type GameMcpCall = { server: string; tool: string; args?: Record<string, unknown> }

/** A project button: a prompt the lead receives as a turn, or an MCP tool the mod calls itself. */
/** `command` names the slash command that runs it, as `/<command>`; `key` its Panel hotkey. */
export type GameAction = { id: string; label: string; command?: string; key?: string } & (
  | { prompt: string }
  | { mcp: GameMcpCall }
)

/** The last run of an MCP action: its text lines, or the error. */
export type ActionRun = { status: 'running' | 'done' | 'error'; lines: string[] }

/** Keyed by action id; `call` names the tool that ran, so a renumbered action drops a stale run. */
export type ActionRuns = Record<string, ActionRun & { call: string; run: number }>

export type GameWorktree = { id: string; path: string; branch: string; displayName: string }

export type GameLocale = 'en' | 'es'

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

/** A cast member's sprite: one to seven rows of one width (1–10); each glyph a key of its `colors`, '.' transparent. */
export type CastFrame = readonly string[]

/** The scene's pet, which Pet hearts; a scene without one pets its hero, Clawd. */
export type ScenePet = {
  name?: LocalizedName
  /** One to four walking frames, all the size of the first. */
  frames: readonly CastFrame[]
  /** Shown while it is petted. */
  happy: CastFrame
  colors: Readonly<Record<string, number>>
}

/** What Jev decided, as the advisor acts it out. */
export type AdvisorGesture =
  | 'lowered'
  | 'raised'
  | 'approved'
  | 'unsure'
  | 'escalated'
  | 'ciRunning'
  | 'ciPassed'
  | 'ciFailed'

/** Who stands for Jev in the scene; the gesture props are the game's, the body the scene's. */
export type SceneAdvisor = {
  name?: LocalizedName
  /** One to four idle frames, all the size of the first. */
  frames: readonly CastFrame[]
  /** The body while one gesture plays, in place of the idle frames. */
  gestures?: Readonly<Partial<Record<AdvisorGesture, CastFrame>>>
  colors: Readonly<Record<string, number>>
}

export type SceneCast = { pet?: ScenePet; advisor?: SceneAdvisor }

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
  /** The pet and Jev's advisor; either left out keeps Clawd or the referee. */
  cast?: SceneCast
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
  /** Absent from a host older than project actions or with none configured. */
  actions?: GameAction[]
  /** How the project's lead orchestrates; absent from an older host. */
  lead?: GameLead
  /** Whether this pane leads or a lead launched it; absent from an older host. */
  role?: GameRole
}

export type GameLead = { autostart: boolean; cap: number; label?: string }

export type GameRole = 'lead' | 'member'

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

/** One of Jev's decisions as the Panel lists it; `title` null is the main conversation's model. */
export type AdvisorLogEntry = {
  key: string
  title: string | null
  model: string | null
  effort: string | number | null
  verdict: string
  gesture: AdvisorGesture | null
  at: number
}

/** Jev's latest decisions in this pane, oldest first, a few at most. */
export type AdvisorLog = { decisions: AdvisorLogEntry[] }

declare module 'claude-code' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- only an interface merges into the engine's
  interface PluginState {
    'orca-game': {
      fleet: FleetState
      allies: AlliesState
      advisor: AdvisorLog
      actions: ActionRuns
      /** True exactly while the game draws other plugins' lines (mode not off and HUD on). */
      absorbing: boolean
    }
    // Read, never depended on: hooks/allies.ts checks the shape at runtime.
    'orca-jev-mod-skills': { advisor: unknown }
  }
}
