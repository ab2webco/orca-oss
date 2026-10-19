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
import { readWorktreeGameSceneFile } from '../worktree-game-scene-file'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  resolveOrchestratorGameConfig,
  resolveOrchestratorGameIntegrations,
  resolveOrchestratorGameLead,
  type ResolvedOrchestratorGameConfig
} from '../../shared/orchestrator-game-config'
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
  parseOrchestratorGameScene,
  type OrchestratorGameSceneExtension,
  type OrchestratorGameSceneSource
} from '../../shared/orchestrator-game-scene'
import { ORCHESTRATOR_GAME_SCENE_FILE_SOURCE } from '../../shared/orchestrator-game-scene-file'
import { desktopGameTimezoneOf } from '../../shared/orchestrator-game-render'
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
  /** The project's STOP; absent leaves `stopped` out, as from an older host. */
  readStop?: () => Promise<GameStop | null>
  /** The project's inboxes; read only for a lead. */
  readInboxes?: () => Promise<GameInboxSummary[]>
  /** My open PRs and tickets across the repo, not only this worktree's. */
  readProjectWork?: (args: {
    todo: OrchestratorGameTodoSource | null
    workItem: GameWorkItem | null
  }) => Promise<GameProjectWork>
}

// `notes` are parts of a scene that still draws, left out; `warning` means it fell back to Quest.
type SceneFileOutcome =
  | { scene: OrchestratorGameSceneExtension; warning?: undefined; notes: string[] }
  | { scene?: undefined; warning: string; notes?: undefined }

// Why re-read every build: a scene being authored should redraw on the next poll, not after a restart.
async function readSceneFile(
  resolved: ResolvedOrchestratorGameConfig,
  worktree: NonNullable<OrchestratorGameStateInput['worktree']> | null
): Promise<SceneFileOutcome | null> {
  const path = resolved.sceneFile
  if (path === null) {
    return null
  }
  const id = resolved.config.scene
  const failed = (reason: string): SceneFileOutcome => ({
    warning: `Scene file ${path}: ${reason}; drawing Quest`
  })
  if (!worktree) {
    return failed('no worktree to read it from')
  }
  let text: string
  try {
    text = await readWorktreeGameSceneFile(worktree.path, worktree.connectionId, path)
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error))
  }
  const parsed = parseOrchestratorGameScene(text, id)
  return parsed.ok
    ? {
        scene: { id, pluginId: ORCHESTRATOR_GAME_SCENE_FILE_SOURCE, definition: parsed.definition },
        notes: parsed.warnings.map((one) => `Scene file ${path}: ${one}; drawn without it`)
      }
    : failed(parsed.error)
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
  const tracker = resolved.config.tracker && input.worktree !== null
  const readScenes = input.readScenes
  const { readStop, readInboxes, readLeadElsewhere } = input
  const [review, plane, linear, sceneSources, sceneFile, stop, inboxes, leadElsewhere] =
    await Promise.all([
      input.worktree ? settle(input.readReview) : Promise.resolve(null),
      tracker ? settle(input.readPlane) : Promise.resolve(null),
      tracker ? settle(input.readLinear) : Promise.resolve(null),
      readScenes ? settle(readScenes) : Promise.resolve(null),
      readSceneFile(resolved, input.worktree),
      readStop ? settleGameStop(readStop) : Promise.resolve(null),
      readInboxes && !input.callerParentPaneKey ? settle(readInboxes) : Promise.resolve(null),
      readLeadElsewhere ? settle(readLeadElsewhere) : Promise.resolve(null)
    ])
  const scenes = orchestratorGameScenesOf(sceneSources ?? [])
  const config = {
    ...resolved.config,
    ...(sceneFile?.warning === undefined ? {} : { scene: DEFAULT_ORCHESTRATOR_GAME_CONFIG.scene }),
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
  const lead = resolveOrchestratorGameLead(layers)
  const role = input.callerParentPaneKey ? 'member' : 'lead'
  const actions = gameStateActionsOf({
    role,
    lead,
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
    sources: resolved.sources,
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
    lead,
    role,
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
    ...(projectState ? { project: projectState } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    locale: orchestratorGameLocaleOf(input.settings?.uiLanguage, input.systemLocale ?? '')
  }
}
