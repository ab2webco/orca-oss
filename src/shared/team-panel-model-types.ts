import type { CheckStatus } from './github/pull-request-types'
import type { HostedReviewProvider, HostedReviewState } from './hosted-review'
import type { OrchestratorGameSceneExtension } from './orchestrator-game-scene'
import type { GameReviewVerdict, GameStatusGroup } from './orchestrator-game-state'
import type { GameLaunchChosenBy, GameTicketKind } from './orchestrator-game-ticket-kind'
import type { TeamLeadAction } from './team-panel-list-action'
import type { TeamAction } from './team-panel-actions'
import type { TeamSteward, TeamStewardCredit } from './team-panel-steward'
import type { TeamXp } from './team-xp-model'

// Why: one view model for the desktop Team panel and the mobile sheet (ORCA-1048). It holds ids
// and facts only; each client translates words and maps a status to its own tokens.

/** The colour language: red, amber, blue, green, grey. Meanings are fixed; hues are a setting. */
/** `failed` asks for action but is no question to the person; `closed` asks for nothing. */
export type TeamStatus = 'attention' | 'failed' | 'risk' | 'working' | 'done' | 'idle' | 'closed'

/** The flow a card's phase word names: Plan, Docs, Code, Tests, PR, Merge (the mod's FlowPhase). */
export type TeamFlowPhase = 'plan' | 'docs' | 'code' | 'tests' | 'pr' | 'merge'

/** The session's own state; the extra ids are what keeps a member from working. */
export type TeamCondition =
  | 'working'
  | 'waiting'
  | 'idle'
  | 'done'
  | 'starting'
  | 'queued'
  | 'paused'
  | 'asleep'
  | 'limited'
  | 'loggedOut'
  | 'unreachable'
  | 'gone'
  | 'startFailed'

/** Where a session runs; `environmentId` is how a client opens a paired host's terminal. */
export type TeamHost =
  | { kind: 'local' }
  | { kind: 'remote'; name: string; environmentId: string | null; reachable: boolean }

/** What the agent does now, shown instead of the prompt. */
export type TeamLiveAction =
  | { kind: 'tool'; tool: string; detail: string | null }
  /** An id an MCP call named, turned into a link by a project rule. */
  | { kind: 'link'; name: string; id: string; url: string; running: boolean }
  /** The agent asks the user, as written; `options` are its choices when it offers some. */
  | { kind: 'question'; text: string; options: string[] }

/** Who picked the model a card names: the advisor's (Jev's) router, Orca's steward, or the lead by ticket kind. */
export type TeamModelCredit =
  | TeamStewardCredit
  | {
      by: 'advisor'
      /** The session's own model when the router moved it; null when it kept it. */
      from: string | null
      reason: string | null
    }
  | { by: 'lead'; from: null; reason: GameTicketKind; source: GameLaunchChosenBy['source'] }

/** `source`: Jev in the pane, the session's own hooks, or Orca's launch choice. */
export type TeamModel = {
  label: string
  effort: string | null
  source: 'advisor' | 'steward' | 'session' | 'launch'
  /** Absent where no router or chooser is known, so the card names the model alone. */
  credit?: TeamModelCredit
}

/** `usedPercent` is the account's 5-hour window; null when not reported. */
export type TeamAccount = {
  provider: 'claude' | 'codex'
  email: string
  usedPercent: number | null
  /** The 7-day window; absent where only the 5-hour reading is known. */
  weeklyPercent?: number | null
  /** The managed account id, so a client can read its own live usage; absent when unknown. */
  id?: string
}

export type TeamTicket = {
  identifier: string
  /** Null when the ticket was read from a name or branch, not the tracker. */
  title: string | null
  url: string | null
  statusGroup: GameStatusGroup | null
}

export type TeamPullRequest = {
  provider: Exclude<HostedReviewProvider, 'unsupported'>
  number: number
  title: string
  url: string
  state: HostedReviewState
  ci: CheckStatus | 'none'
  verdict: GameReviewVerdict | null
  /** Known only once merged with every fact read; null otherwise. */
  perfectMerge: boolean | null
}

/** What a client needs to open the session in a center tab. */
export type TeamSessionRef = {
  paneKey: string
  terminalHandle: string | null
  worktreeId: string | null
  host: TeamHost
}

/** Shared by the lead, member cards and no-team rows. */
export type TeamAgentFacts = TeamSessionRef & {
  name: string
  agentType: string | null
  status: TeamStatus
  condition: TeamCondition
  /** When the current condition began, ms on the host's clock; null when unknown. */
  since: number | null
  liveAction: TeamLiveAction | null
  model: TeamModel | null
  account: TeamAccount | null
  /** Jev's latest decisions in this pane, newest last; absent when its Jev sent none. */
  decisions?: TeamAdvisorDecision[]
  /** Orca's steward in a member pane (ORCA-1242); absent without one or from an older host. */
  steward?: TeamSteward
}

/** One decision Jev made in a pane: its id, verdict and the gesture the game plays for it. */
export type TeamAdvisorDecision = { id: string; verdict: string; gesture: string | null }

export type TeamMemberCard = TeamAgentFacts & {
  /** The persistent game character (ORCA-1034); null when the scene has none for it. */
  characterKey: string | null
  ticket: TeamTicket | null
  /** The branch it works on: its own worktree's, else the lead's; null or absent when unknown. */
  branch?: string | null
  flowPhase: TeamFlowPhase | null
  /** The member's latest report or message, as written; the live action is separate. */
  summary: string | null
  pr: TeamPullRequest | null
  /** Waiting on input, or its ticket has an open question for the user. */
  needsYou: boolean
  /** What it waits on the person for; absent from a client that predates it (ORCA-1231). */
  ask?: TeamMemberAsk | null
  /** When its account's usage limit resets, ms; null when not limited or unknown. */
  limitResetsAt: number | null
  /** Started outside `game launch`: stopped by name, never acted on in bulk. */
  found: boolean
  /** Runs in the lead's folder, which has no git for a worktree of its own (ORCA-1135). */
  inFolder?: true
}

/** A question the Inbox holds (its ticket's, or one asked in its pane), or a permission prompt only its terminal can answer. */
export type TeamMemberAsk = { kind: 'inbox' } | { kind: 'permission'; tool: string | null }

/** The lead's live step reads as `verb · step` while working, or what it waits on. */
export type TeamLeadCard = TeamAgentFacts & {
  characterKey: string | null
  /** No Lead name is configured, so the card shows "Lead" and offers the setup; absent reads as named (ORCA-1304). */
  isNameDefault?: boolean
  branch: string | null
  /** The oldest question the lead asked the user that is still open; the text stays in Inbox. */
  ownerAsk: { ticket: string | null } | null
  /** Members not finished yet, which a lead whose turn ended still waits on; absent from an older client. */
  waitingOn?: number
}

/** One sub-agent decision Jev made: which agent, on what, and what it did. */
export type TeamAdvisorCall = { agent: string; model: string | null; verdict: string }

/** Jev's row; present only with the advisor plugin. Its words are shown as written. */
export type TeamAdvisorRow = {
  model: string | null
  effort: string | null
  pinned: { model: boolean; effort: boolean }
  line: string | null
  previous: { model: string | null; effort: string | null } | null
  calls: TeamAdvisorCall[]
}

export type TeamInboxCounts = {
  /** Questions for the user, from every project and host; the only number the tab bar shows. */
  forYou: number
  waiting: number
  threads: number
  answered: number
  /** This project's own questions were not read while other projects' show; null message: not published. */
  projectUnread?: { message: string | null }
}

export type TeamPrRow = {
  /** As the provider names it: #12 on GitHub, !12 on GitLab. */
  label: string
  number: number
  title: string
  url: string
  status: TeamStatus
  /** Why it is in that status; `checksUnknown` is no CI reading, never a pass. */
  reason:
    | 'checksFailed'
    | 'checksUnknown'
    | 'conflict'
    | 'inReview'
    | 'ready'
    | 'draft'
    | 'merged'
    | 'closed'
  memberKey: string | null
}

/** `total` counts every open one; the host keeps only the first few rows, `listUrl` opens the rest. */
export type TeamPrList = {
  rows: TeamPrRow[]
  total: number
  listUrl: string | null
  /** Runs instead of opening `listUrl`, when the project says so. */
  listAction: TeamLeadAction | null
}

export type TeamQueueEntry = {
  /** As the provider names it, like #12. */
  label: string
  title: string
  url: string
  /** 1 is next to merge. */
  position: number
  state: 'checks' | 'waiting' | 'failed'
  status: TeamStatus
  /** When it entered the queue, ms; a long wait turns it amber. */
  since: number | null
  /** Whole hours waited, only once the wait is long. */
  longWaitHours: number | null
  memberKey: string | null
}

export type TeamMachine = {
  host: TeamHost
  /** Members running there, and its cap when the host publishes one. */
  running: number
  cap: number | null
  status: TeamStatus
  reading:
    | {
        kind: 'ok'
        cpuCoreCount: number
        totalMemory: number
        availableMemory: number
        loadAverage1m: number | null
        /** Absent from a host older than ORCA-1252: shown unknown, never zero. */
        cpuUsagePercent?: number
        workspaceDiskTotal?: number
        workspaceDiskFree?: number
      }
    | { kind: 'unreachable'; lastSeenAt: number | null }
    /** No figures to show: an SSH target has no Orca to ask, and a saved host may not have answered yet. */
    | { kind: 'unread' }
  /**
   * Whether this lead's members can start there, by `game launch --on`'s own check (ORCA-1207).
   * `unknown`: an older Orca's state does not say, so the row never reads as free.
   */
  launch:
    | { kind: 'ready' }
    | { kind: 'unregistered'; project: string; reason: string }
    | { kind: 'refused'; reason: string }
    | { kind: 'unanswered' }
    | { kind: 'unknown' }
}

/** Display's figures; each is null when Orca has no data for it, and the page says so. */
export type TeamMetrics = {
  /** IANA zone the days are counted in. */
  timezone: string
  mergedPerDay: { day: string; merged: number }[]
  mergedPerHour24h: number[] | null
  leadTimeMedianMs: number | null
  ciGreenPercent: number | null
  ciGreenPerDay: { day: string; percent: number }[] | null
  flakyChecks: number | null
  accounts: { email: string; sessionPercent: number | null; weeklyPercent: number | null }[]
  /** Oldest first, today last; `currency` is ISO 4217. */
  costPerDay: { day: string; amount: number; currency: string }[] | null
}

/** Every tab draws these four states; `unavailable` is a host or setting that cannot supply it. */
export type TeamSection<T> =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | TeamSectionError
  | { kind: 'ready'; value: T }

export type TeamSectionError = {
  kind: 'error'
  message: string
  /** Named only when the read says which provider failed; never guessed from the remote. */
  provider?: string
  /** The provider's budget is spent, so a retry cannot succeed before the reset the message names. */
  limited?: boolean
}

export type TeamTabId = 'team' | 'activity' | 'inbox' | 'prs' | 'queue' | 'machines'

/** A tab that is hidden by a setting, or has no reason to show, is null. */
export type TeamPanelTabs = {
  inbox: TeamSection<TeamInboxCounts>
  prs: TeamSection<TeamPrList> | null
  queue: TeamSection<TeamQueueEntry[]> | null
  machines: TeamSection<TeamMachine[]> | null
}

/** What the live scene draws, as game.state publishes it (`config.scene`, `extensions.scenes`). */
export type TeamSceneSource = {
  /** The project's scene id; null when the host did not say, and Pixel draws Quest. */
  id: string | null
  /** Plugin and file scene definitions the host carried; built-ins are resolved by id. */
  extensions: OrchestratorGameSceneExtension[]
}

/** A To Do ticket no member holds yet, with what work-on sends the lead for it (ORCA-717). */
export type TeamTodoTicket = { identifier: string; title: string; prompt: string }

export type TeamPanelGameModel = TeamPanelTabs & {
  kind: 'team'
  repoId: string
  projectName: string
  lead: TeamLeadCard
  advisor: TeamAdvisorRow | null
  /** Needs-you first, then by status. */
  members: TeamMemberCard[]
  metrics: TeamSection<TeamMetrics>
  /** The team's level; null outside the Game look or without rewards. */
  xp: TeamXp | null
  /** Saved arcade plays and the perfect merge that offers one; null when the arcade is off. */
  arcade: { credits: number; offerPr: number | null } | null
  /** The project's STOP; null when clear. */
  /** `membersRunning`: members the STOP left running, which it does not stop; absent reads as none. */
  stopped: { since: string | null; by: string | null; membersRunning?: number } | null
  scene: TeamSceneSource
  /** Orca's and the project's actions for the dock and its menu, in game.state's order. */
  actions: TeamAction[]
  /** The project's To Do tickets no member holds; empty when the host publishes none. */
  todo: TeamTodoTicket[]
  /** The agent members run, as orca.yaml names it; absent when the host sends no lead. */
  memberAgent?: string
}

/** A row of the no-team Activity view, read from AgentStatusEntry and the worktree. */
export type TeamActivityRow = TeamAgentFacts & {
  repoName: string
  worktreeName: string
  isPrimary: boolean
  /** A game lead's or member's pane: its questions belong to that team's Inbox. */
  inTeam: boolean
  /** The user's latest prompt, as written; the row shows it only while idle. */
  prompt: string | null
  ticket: TeamTicket | null
  pr: TeamPullRequest | null
  /** The newest completed assistant message, as written. */
  lastMessage: string | null
  /** When the prompt cache expires, ms; null when the timer setting is off or unknown. */
  cacheExpiresAt: number | null
  ports: number[]
  note: string | null
  subagentCount: number
  /** Completed tool steps, newest last. */
  recentSteps: { tool: string; detail: string | null }[]
  /** Present only with the advisor plugin and a Jev report for this pane. */
  advisor: TeamAdvisorRow | null
}

/** No game team: one agent or a few separate sessions. */
export type TeamPanelSoloModel = TeamPanelTabs & {
  kind: 'solo'
  /** The row Activity opens on; null with no session. */
  selectedPaneKey: string | null
  rows: TeamActivityRow[]
}

export type TeamPanelModel = TeamPanelGameModel | TeamPanelSoloModel
