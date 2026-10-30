export type GameMode = 'on' | 'zen' | 'flat' | 'off'

/** `openLinks` is where links open: an Orca tab, or the system browser through Orca. */
export type GameConfig = {
  mode: GameMode
  scene: string
  hud: boolean
  rewards: boolean
  openLinks: 'orca' | 'system'
  render: GameRender
  /** An IANA zone hd's day and night follow, or `local` for the machine's clock. */
  timezone: string
}

/** The config layer a key's value came from, as `orca game state` names it. */
export type GameSource = 'default' | 'global' | 'project' | 'local'

/** Each config key's layer; `tracker` is Orca's own key the mod does not draw. */
export type GameSources = Partial<Record<keyof GameConfig | 'tracker', GameSource>>

/** The 5-row pixel art, or the 9 to 10-row 2D-HD scene. */
export type GameRender = 'classic' | 'hd' | 'hd-compact'

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
  /** What Jev in the member's own pane has it on; absent without Jev there or from an older Orca. */
  advisor?: GameMemberAdvisor
  /** The model and effort Orca dispatched the member on; absent when it chose neither or from an older Orca. */
  launch?: GameMemberLaunch
  /** A member on a paired remote host; `stateKnown` is false while that host does not answer. */
  remote?: GameMemberRemote
  /** When its host last saw it work or change state (ms); absent when unknown or from an older host. */
  activeAt?: number
}

export type GameMemberRemote = {
  host: string
  /** The paired environment View opens the member's terminal through. */
  environmentId?: string
  stateKnown: boolean
  /** The host answered and the member's terminal is no longer there. */
  gone?: true
}

export type GameMemberLaunch = { model: string | null; effort: string | null }

/** A model and effort as Jev names them; null where Jev set none. */
export type GameMemberAdvisorPick = { model: string | null; effort: string | null }

/** Jev's optional detail from a newer report; a version 1 report carries none of it. */
export type GameMemberAdvisorDetail = {
  line?: string | null
  skill?: string | null
  tool?: string | null
  hold?: string | null
  confidence?: string | null
  routedModel?: string | null
  sessionModel?: string | null
}

/** `pinned`: Orca applied that dimension at launch; `previous`: before Jev's latest switch. */
export type GameMemberAdvisor = GameMemberAdvisorPick &
  GameMemberAdvisorDetail & {
    pinned: { model: boolean; effort: boolean }
    previous?: GameMemberAdvisorPick
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
  /** The host's perfect-merge decision; absent before the merge or without every fact. */
  perfectMerge?: boolean
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

export type CharacterAccessory = 'crown' | 'halo' | 'horns' | 'antenna' | 'bow' | 'feather' | 'cape'

/** A palette laid over the phase costumes, glyph by glyph, and an accessory drawn around the head. */
export type CharacterVariant = {
  colors?: Readonly<Record<string, number>>
  accessory?: CharacterAccessory
  accessoryColor?: number
}

/** A roster entry with a look of its own: a variant of the phase costumes, or costumes of its own. */
export type SceneCharacter = {
  name: LocalizedName
  variant?: CharacterVariant
  costumes?: Readonly<Record<ScenePhase, Costume>>
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
  | 'stopped'
  /** Claude's own advisor call is open, then its advice came back; Jev decides neither. */
  | 'consulting'
  | 'advised'

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
  /** Names Orca gives a lead's members, in order. */
  roster?: readonly LocalizedName[]
  /** The roster entries drawn in their own look; every other member wears the phase costume. */
  characters?: readonly SceneCharacter[]
  /** Palette variants; the band shows one a day in turn with the plain looks. */
  themes?: readonly SceneTheme[]
}

export type LookColor =
  | 'skyTop'
  | 'skyBottom'
  | 'sun'
  | 'far'
  | 'snow'
  | 'near'
  | 'ground'
  | 'plant'
  | 'cloud'

/** Colors mixed into every phase's look, `weight` of the way from the look's own. */
export type SceneTheme = {
  name: LocalizedName
  weight: number
  look: Readonly<Partial<Record<LookColor, number>>>
}

export type GameSceneExtension = { id: string; pluginId: string; definition: SceneDefinition }

export type GameState = {
  config: Partial<GameConfig>
  /** Absent from a host that sends no layers. */
  sources?: GameSources
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
  /** Absent from a host older than reward weights, which awards the baseline. */
  rewardWeights?: RewardWeights
  /** Whether this pane leads or a lead launched it; absent from an older host. */
  role?: GameRole
  /** The project's live lead when it is another pane; absent from an older host. */
  leadElsewhere?: { handle: string }
  /** Orca's UI language now; absent from an older host, which keeps the launch language. */
  locale?: GameLocale
  /** The scopes Orca can store a view in for this pane; absent from an older host. */
  viewScopes?: ('project' | 'global')[]
  /** The view this machine's resources suggest; absent from an older host. */
  suggestedView?: 'off' | 'flat' | 'zen' | '2d-classic' | '2d-hd'
  /** The account's lowest GitHub bucket while Orca reports the budget low; absent otherwise. */
  githubLow?: { remaining: number; limit: number }
}

export type GameLead = { autostart: boolean; cap: number; label?: string }

export type GameRole = 'lead' | 'member'

export type FleetState = {
  isLoading: boolean
  refreshedAt: number
  state: GameState | null
  note: string
  xp: number
  /** The latest rewards, newest first; absent in an atom an older mod stored. */
  recent?: readonly RecentReward[]
}

export type RewardKind =
  | 'review-merged'
  | 'ci-green'
  | 'work-item-review'
  | 'work-item-done'
  | 'member-claimed'
  | 'perfect-merge'

/** XP per reward as the project tunes it; a kind left out keeps the baseline, 0 turns it off. */
export type RewardWeights = Readonly<Partial<Record<RewardKind, number>>>

export type RecentReward = { label: string; xp: number; at: number }

/** A line another plugin set with `$.ui.status`, held for the allies strip while the game draws. */
export type AllyStatus = { plugin: string; text: string }

export type AlliesState = { statuses: AllyStatus[] }

/** One of Jev's decisions as the Panel lists it; `id` null is the main conversation's model. */
export type AdvisorLogEntry = {
  key: string
  id: string | null
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
