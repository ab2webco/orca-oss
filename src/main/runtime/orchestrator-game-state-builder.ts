import { readWorktreeOrcaYaml } from '../worktree-orca-yaml'
import {
  gameFleetOf,
  liveLinkedItemOf,
  settle,
  type GameAgentRow,
  type GameMemberAccountOf,
  type GameMemberLimitOf,
  type GameMemberWork,
  type ReadLinkedStatus
} from './orchestrator-game-fleet'
import { readSceneFileOrCarried } from './orchestrator-game-scene-file-read'
import type { CarriedGameScene } from './orchestrator-game-carried-scene'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  resolveOrchestratorGameConfig,
  resolveOrchestratorGameIntegrations,
  resolveOrchestratorGameRewardWeights
} from '../../shared/orchestrator-game-config'
import type { GameHostProfile } from '../../shared/orchestrator-game-lead'
import {
  gameLeadOverPairedHostsOf,
  type PairedGameHostEntry
} from './orchestrator-game-paired-hosts'
import {
  builtInGameActivityRules,
  gameActivityOf,
  type GameActivityCall
} from '../../shared/orchestrator-game-activity'
import type { GameActivityMemory } from './orchestrator-game-activity-memory'
import { compileGameActivityRule } from '../../shared/orchestrator-game-integrations'
import { gameActionsOf, renderGameWorkPrompt } from '../../shared/orchestrator-game-actions'
import { gameListActionsOf, gameStateActionsOf } from '../../shared/orchestrator-game-lead-actions'
import {
  activityGameLinksOf,
  gameLinksOf,
  projectGameLinksOf
} from '../../shared/orchestrator-game-links'
import {
  orchestratorGameScenesOf,
  type OrchestratorGameSceneSource
} from '../../shared/orchestrator-game-scene'
import { desktopGameTimezoneOf } from '../../shared/orchestrator-game-render'
import {
  shownOrchestratorGameModeOf,
  type OrchestratorGameViewId
} from '../../shared/orchestrator-game-view'
import { orchestratorGameLocaleOf } from '../claude/orchestrator-game-launch'
import {
  gameReviewOf,
  statusGroupOfName,
  statusGroupOfPlane,
  type GameActivity,
  type GameMemberWorktree,
  type GameWorkItem,
  type OrchestratorGameState
} from '../../shared/orchestrator-game-state'
import type {
  GameProjectWork,
  OrchestratorGameTodoSource
} from '../../shared/orchestrator-game-project-work'
import type { GlobalSettings } from '../../shared/types'
import { settleGameStop, type GameStop } from '../../shared/orchestrator-game-stop-state'
import type { GameInboxSummary } from '../../shared/orchestrator-game-inbox'
import type { GameGitHubBudget } from '../../shared/orchestrator-game-github-budget'
import type { GameMemberAdvisor } from '../../shared/orchestrator-game-member-advisor'
import type { GameMemberLaunch } from '../../shared/orchestrator-game-member-launch'
import type { WorkspaceLinkedItem } from '../../shared/worktree/types'

type TrackerItem = { identifier: string; title: string; url: string; stateName: string }

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

export async function buildOrchestratorGameState(
  input: OrchestratorGameStateInput
): Promise<OrchestratorGameState> {
  const project = input.worktree
    ? await readWorktreeOrcaYaml(input.worktree.path, input.worktree.connectionId)
    : null
  const layers = {
    global: input.settings?.orchestratorGame,
    project: project?.orchestratorGame,
    local: input.worktree?.repoId
      ? input.settings?.orchestratorGameProjects?.[input.worktree.repoId]
      : undefined
  }
  const resolved = resolveOrchestratorGameConfig(layers)
  const integrations = resolveOrchestratorGameIntegrations(layers)
  // Why not for a member: every member pane polls this, and its band takes the ticket from its own name.
  const tracker = resolved.config.tracker && input.worktree !== null && !input.callerParentPaneKey
  const readScenes = input.readScenes
  const { readStop, readInboxes, readLeadElsewhere, readOpenOwnerQuestions, readGitHubBudget } =
    input
  const leadOnly = <T>(read: (() => Promise<T>) | undefined): Promise<T | null> =>
    read && !input.callerParentPaneKey ? settle(read) : Promise.resolve(null)
  const [
    review,
    plane,
    linear,
    sceneSources,
    sceneFile,
    stop,
    inboxes,
    leadElsewhere,
    suggested,
    openOwnerQuestions,
    githubBudget
  ] = await Promise.all([
    input.worktree ? settle(input.readReview) : Promise.resolve(null),
    tracker ? settle(input.readPlane) : Promise.resolve(null),
    tracker ? settle(input.readLinear) : Promise.resolve(null),
    readScenes ? settle(readScenes) : Promise.resolve(null),
    readSceneFileOrCarried(resolved, input.worktree, input.readCarriedScene),
    readStop ? settleGameStop(readStop) : Promise.resolve(null),
    leadOnly(readInboxes),
    readLeadElsewhere ? settle(readLeadElsewhere) : Promise.resolve(null),
    input.suggestedView ? settle(input.suggestedView) : Promise.resolve(null),
    leadOnly(readOpenOwnerQuestions),
    readGitHubBudget ? settle(readGitHubBudget) : Promise.resolve(null)
  ])
  const scenes = orchestratorGameScenesOf(sceneSources ?? [])
  const config = {
    ...resolved.config,
    mode: shownOrchestratorGameModeOf(resolved.config),
    ...(sceneFile?.scene
      ? { scene: sceneFile.scene.id }
      : sceneFile?.warning === undefined
        ? {}
        : { scene: DEFAULT_ORCHESTRATOR_GAME_CONFIG.scene }),
    timezone: desktopGameTimezoneOf(resolved.config.timezone)
  }
  let workItem: GameWorkItem | null = null
  if (plane) {
    workItem = {
      provider: 'plane',
      identifier: plane.identifier,
      title: plane.title,
      url: plane.url,
      status: plane.stateName,
      statusGroup: statusGroupOfPlane(plane.stateGroup, plane.stateName)
    }
  } else if (linear) {
    workItem = {
      provider: 'linear',
      identifier: linear.identifier,
      title: linear.title,
      url: linear.url,
      status: linear.stateName,
      statusGroup: statusGroupOfName(linear.stateName)
    }
  } else if (tracker) {
    workItem = await liveLinkedItemOf(input.worktree?.linkedWorkItem, input.readLinkedStatus)
  }
  const gameReview = gameReviewOf(review)
  const readProjectWork = input.readProjectWork
  // Why `tracker`: it is already off for a member, whose band shows no project work.
  const projectWork =
    tracker && readProjectWork
      ? await settle(() => readProjectWork({ todo: integrations.todo, workItem }))
      : null
  const placeholders = {
    'workItem.identifier': workItem?.identifier,
    'workItem.provider': workItem?.provider,
    branch: input.worktree?.branch,
    'review.number': gameReview ? String(gameReview.number) : undefined
  }
  const projectLinks = projectGameLinksOf(integrations.links, placeholders)
  const role = input.callerParentPaneKey ? 'member' : 'lead'
  const placed = await gameLeadOverPairedHostsOf(
    layers,
    role === 'lead' ? input : { host: input.host }
  )
  const actions = gameStateActionsOf({
    role,
    lead: placed.lead,
    project: gameActionsOf(integrations.actions, placeholders)
  })
  const workPrompt = integrations.todo === 'off' ? undefined : integrations.todo?.workPrompt
  const listActions = gameListActionsOf(actions, {
    todo: integrations.todo === 'off' ? undefined : integrations.todo?.action,
    reviews: integrations.reviews.action
  })
  const todo = projectWork?.todo ?? null
  const projectState = projectWork && {
    reviews: projectWork.reviews && { ...projectWork.reviews, ...listActions.reviews },
    todo: todo && {
      ...todo,
      ...listActions.todo,
      items: todo.items.map((one) => ({ ...one, prompt: renderGameWorkPrompt(workPrompt, one) }))
    }
  }
  // Why: project rules first, so a repo can override what Orca's own integrations would link.
  const rules = [
    ...integrations.activity.flatMap((rule) => compileGameActivityRule(rule) ?? []),
    ...builtInGameActivityRules({ workItem, review: gameReview })
  ]
  const activityOf = (paneKey: string): GameActivity | null => {
    const found = input.mcpCallsOf ? gameActivityOf(input.mcpCallsOf(paneKey), rules) : null
    return input.activityMemory ? input.activityMemory.recall(paneKey, found) : found
  }
  const agents = await gameFleetOf({
    agents: input.agents,
    members: input.members ?? [],
    leaderPaneKey: input.leaderPaneKey,
    teamHandles: input.teamHandles,
    terminalHandleOf: input.terminalHandleOf,
    activityOf,
    readMemberWork: input.readMemberWork,
    readLinkedStatus: input.readLinkedStatus,
    accountOf: input.accountOf,
    limitOf: input.limitOf,
    advisorOf: input.advisorOf,
    launchOf: input.launchOf,
    leadWorktreeId: input.worktree?.id ?? null
  })
  const leaderActivity = input.leaderPaneKey ? activityOf(input.leaderPaneKey) : null
  return {
    config,
    // Why: a hidden game's mode comes from the layer that hid it, not the one that chose the view.
    sources: config.show ? resolved.sources : { ...resolved.sources, mode: resolved.sources.show },
    // Why the scene file first: the mod's note shows only the first warning, and this one changes the art.
    warnings: [
      ...(sceneFile?.warning === undefined ? [] : [sceneFile.warning]),
      ...(sceneFile?.notes ?? []),
      ...(stop?.warning ? [stop.warning] : []),
      ...(project?.orchestratorGameWarnings ?? []),
      ...resolved.warnings,
      ...scenes.warnings,
      ...listActions.warnings
    ],
    worktree: input.worktree
      ? {
          id: input.worktree.id,
          path: input.worktree.path,
          branch: input.worktree.branch,
          displayName: input.worktree.displayName
        }
      : null,
    agents,
    ...placed,
    rewardWeights: resolveOrchestratorGameRewardWeights(layers),
    role,
    viewScopes: input.worktree?.repoId ? ['project', 'global'] : ['global'],
    ...(suggested ? { suggestedView: suggested } : {}),
    ...(leadElsewhere ? { leadElsewhere: { handle: leadElsewhere } } : {}),
    review: gameReview,
    workItem,
    extensions: { scenes: sceneFile?.scene ? [sceneFile.scene, ...scenes.scenes] : scenes.scenes },
    links: gameLinksOf({
      review: gameReview,
      workItem,
      extra: [...projectLinks, ...activityGameLinksOf(agents)]
    }),
    ...(leaderActivity ? { activity: leaderActivity } : {}),
    ...(stop ? { stopped: stop.stopped } : {}),
    ...(inboxes ? { inboxes } : {}),
    ...(openOwnerQuestions === null ? {} : { openOwnerQuestions }),
    ...(projectState ? { project: projectState } : {}),
    ...(githubBudget ? { githubBudget } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    locale: orchestratorGameLocaleOf(input.settings?.uiLanguage, input.systemLocale ?? '')
  }
}
