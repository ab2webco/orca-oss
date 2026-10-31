import type {
  GameAgentRow,
  GameMemberAccountOf,
  GameMemberGlobalLoginOf,
  GameMemberLimitOf,
  GameMemberWork,
  ReadLinkedStatus
} from './orchestrator-game-fleet'
import type { CarriedGameScene } from './orchestrator-game-carried-scene'
import type { GameActivityMemory } from './orchestrator-game-activity-memory'
import type { GameHostProfile } from '../../shared/orchestrator-game-lead'
import type { GameActivityCall } from '../../shared/orchestrator-game-activity'
import type { OrchestratorGameSceneSource } from '../../shared/orchestrator-game-scene'
import type { OrchestratorGameViewId } from '../../shared/orchestrator-game-view'
import type {
  gameReviewOf,
  GameMemberWorktree,
  GameWorkItem
} from '../../shared/orchestrator-game-state'
import type {
  GameProjectWork,
  OrchestratorGameTodoSource
} from '../../shared/orchestrator-game-project-work'
import type { GlobalSettings } from '../../shared/types'
import type { GameMerge } from '../../shared/orchestrator-game-events'
import type { GameStop } from '../../shared/orchestrator-game-stop-state'
import type { GameInboxSummary } from '../../shared/orchestrator-game-inbox'
import type { GameGitHubBudget } from '../../shared/orchestrator-game-github-budget'
import type { GameMemberAdvisor } from '../../shared/orchestrator-game-member-advisor'
import type { GameMemberLaunch } from '../../shared/orchestrator-game-member-launch'
import type { WorkspaceLinkedItem } from '../../shared/worktree/types'
import type { PairedGameHostEntry } from './orchestrator-game-paired-hosts'
import type { TrackerItem } from './orchestrator-game-lead-work-item'

export type OrchestratorGameStateInput = {
  settings:
    | Partial<Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects' | 'uiLanguage'>>
    | undefined
  /** The OS locale behind a `system` UI language. */
  systemLocale?: string
  /** Orca's machine, which sets the member cap no layer sets. */
  host?: GameHostProfile
  /** The paired hosts and what each publishes; read only for a lead (ORCA-888). */
  readPairedHosts?: () => Promise<PairedGameHostEntry[]>
  worktree: {
    id: string
    repoId: string | null
    /** SSH connection of the worktree's repo; its orca.yaml is read from that host. */
    connectionId?: string | null
    path: string
    branch: string
    displayName: string
    linkedWorkItem: WorkspaceLinkedItem | null | undefined
  } | null
  agents: GameAgentRow[]
  /** Sessions the lead launched in other worktrees; its own worktree's come in `agents`. */
  members?: { row: GameAgentRow; worktree: GameMemberWorktree }[]
  /** Every other session on this machine; read only for a lead (ORCA-914). */
  found?: { row: GameAgentRow; worktree: GameMemberWorktree }[]
  leaderPaneKey: string | null
  /** The calling pane's own launcher; set when a lead started it through orchestration. */
  callerParentPaneKey?: string | null
  /** The handle of the project's live lead when it is not the caller. */
  readLeadElsewhere?: () => Promise<string | null>
  terminalHandleOf?: (paneKey: string) => string | null
  /** The calling Team's terminals; when known, agents outside it are left out. */
  teamHandles?: ReadonlySet<string> | null
  /** A pane's recent MCP calls, newest first, held by the hook server in memory. */
  mcpCallsOf?: (paneKey: string) => readonly GameActivityCall[]
  /** Keeps each pane's last match once its call leaves `mcpCallsOf`'s bounded window. */
  activityMemory?: GameActivityMemory
  readReview: () => Promise<Parameters<typeof gameReviewOf>[0]>
  readPlane: () => Promise<(TrackerItem & { stateGroup: string }) | null>
  readLinear: () => Promise<TrackerItem | null>
  readLinkedStatus?: ReadLinkedStatus
  accountOf?: GameMemberAccountOf
  globalLoginOf?: GameMemberGlobalLoginOf
  limitOf?: GameMemberLimitOf
  advisorOf?: (paneKey: string) => GameMemberAdvisor | null
  launchOf?: (paneKey: string) => GameMemberLaunch | null
  /** A member worktree's own review and linked ticket; read only for members outside the lead's. */
  readMemberWork?: (worktreeId: string) => Promise<GameMemberWork | null>
  readScenes?: () => Promise<OrchestratorGameSceneSource[]>
  /** The scene a member's lead draws; used only when the worktree's own file does not read. */
  readCarriedScene?: () => Promise<CarriedGameScene | null>
  /** The project's STOP; absent leaves `stopped` out, as from an older host. */
  readStop?: () => Promise<GameStop | null>
  /** The project's inboxes; read only for a lead. */
  readInboxes?: () => Promise<GameInboxSummary[]>
  /** Questions the lead asked the person that wait for an answer; read only for a lead. */
  readOpenOwnerQuestions?: () => Promise<number>
  /** The members' latest recorded merges; read only for a lead. */
  readMerges?: () => Promise<GameMerge[]>
  /** The view the host's resources suggest; absent leaves `suggestedView` out. */
  suggestedView?: () => Promise<OrchestratorGameViewId | undefined>
  /** github.com's budget and Orca's share of it; absent leaves `githubBudget` out. */
  readGitHubBudget?: () => Promise<GameGitHubBudget | null>
  /** My open PRs and tickets across the repo, not only this worktree's. */
  readProjectWork?: (args: {
    todo: OrchestratorGameTodoSource | null
    workItem: GameWorkItem | null
  }) => Promise<GameProjectWork>
}
