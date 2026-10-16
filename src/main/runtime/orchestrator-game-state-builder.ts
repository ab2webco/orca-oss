import { readWorktreeOrcaYaml } from '../worktree-orca-yaml'
import { readWorktreeGameSceneFile } from '../worktree-game-scene-file'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  resolveOrchestratorGameConfig,
  resolveOrchestratorGameIntegrations,
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
import {
  gameAgentOf,
  gameReviewOf,
  statusGroupOfName,
  statusGroupOfPlane,
  type GameActivity,
  type GameAgent,
  type GameMemberWorktree,
  type GameStatusGroup,
  type GameWorkItem,
  type OrchestratorGameState
} from '../../shared/orchestrator-game-state'
import type {
  GameProjectWork,
  OrchestratorGameTodoSource
} from '../../shared/orchestrator-game-project-work'
import type { GlobalSettings } from '../../shared/types'
import type { RuntimeWorktreeAgentRow } from '../../shared/runtime-types'
import type { WorkspaceLinkedItem } from '../../shared/worktree/types'

type TrackerItem = { identifier: string; title: string; url: string; stateName: string }

export type OrchestratorGameStateInput = {
  settings: Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'> | undefined
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
  readLinkedStatus?: (
    linked: WorkspaceLinkedItem
  ) => Promise<{ name: string; group?: GameStatusGroup } | null>
  readScenes?: () => Promise<OrchestratorGameSceneSource[]>
  /** My open PRs and tickets across the repo, not only this worktree's. */
  readProjectWork?: (args: {
    todo: OrchestratorGameTodoSource | null
    workItem: GameWorkItem | null
  }) => Promise<GameProjectWork>
}

type GameAgentRow = Pick<
  RuntimeWorktreeAgentRow,
  'paneKey' | 'state' | 'agentType' | 'displayName' | 'taskTitle' | 'toolName'
> & { parentPaneKey?: string | null }

// Why: a tracker that is offline or unauthenticated must cost the game its badge, never the whole state.
const settle = <T>(read: () => Promise<T | null>): Promise<T | null> => read().catch(() => null)

function linkedItemOf(linked: WorkspaceLinkedItem | null | undefined): GameWorkItem | null {
  if (!linked || linked.type !== 'issue') {
    return null
  }
  const identifier =
    linked.jiraIdentifier ??
    linked.linearIdentifier ??
    linked.planeIdentifier ??
    `#${linked.number}`
  return {
    provider: linked.provider,
    identifier,
    title: linked.title,
    url: linked.url,
    status: '',
    statusGroup: 'unknown'
  }
}

type SceneFileOutcome =
  | { scene: OrchestratorGameSceneExtension; warning?: undefined }
  | { scene?: undefined; warning: string }

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
        scene: { id, pluginId: ORCHESTRATOR_GAME_SCENE_FILE_SOURCE, definition: parsed.definition }
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
  const [review, plane, linear, sceneSources, sceneFile] = await Promise.all([
    input.worktree ? settle(input.readReview) : Promise.resolve(null),
    tracker ? settle(input.readPlane) : Promise.resolve(null),
    tracker ? settle(input.readLinear) : Promise.resolve(null),
    readScenes ? settle(readScenes) : Promise.resolve(null),
    readSceneFile(resolved, input.worktree)
  ])
  const scenes = orchestratorGameScenesOf(sceneSources ?? [])
  const config =
    sceneFile?.warning === undefined
      ? resolved.config
      : { ...resolved.config, scene: DEFAULT_ORCHESTRATOR_GAME_CONFIG.scene }
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
    const linked = input.worktree?.linkedWorkItem
    const readLinkedStatus = input.readLinkedStatus
    workItem = linkedItemOf(linked)
    const live =
      workItem && linked && readLinkedStatus ? await settle(() => readLinkedStatus(linked)) : null
    if (workItem && live) {
      workItem = {
        ...workItem,
        status: live.name,
        statusGroup: live.group ?? statusGroupOfName(live.name)
      }
    }
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
  const actions = gameActionsOf(integrations.actions, placeholders)
  const workPrompt = integrations.todo === 'off' ? undefined : integrations.todo?.workPrompt
  const todo = projectWork?.todo
  const projectState =
    projectWork && todo
      ? {
          ...projectWork,
          todo: {
            ...todo,
            items: todo.items.map((one) => ({
              ...one,
              prompt: renderGameWorkPrompt(workPrompt, one)
            }))
          }
        }
      : projectWork
  // Why: project rules first, so a repo can override what Orca's own integrations would link.
  const rules = [
    ...integrations.activity.flatMap((rule) => compileGameActivityRule(rule) ?? []),
    ...builtInGameActivityRules({ workItem, review: gameReview })
  ]
  const activityOf = (paneKey: string): GameActivity | null => {
    const found = input.mcpCallsOf ? gameActivityOf(input.mcpCallsOf(paneKey), rules) : null
    return input.activityMemory ? input.activityMemory.recall(paneKey, found) : found
  }
  const teamHandles = input.teamHandles
  const leaderPaneKey = input.leaderPaneKey
  const isMemberRow = (row: GameAgentRow): boolean =>
    leaderPaneKey !== null && row.parentPaneKey === leaderPaneKey
  // Why: a member reports to this lead wherever it runs; another lead's member is never ours.
  const rows = teamHandles
    ? input.agents.filter((row) => {
        const handle = input.terminalHandleOf?.(row.paneKey)
        return (
          isMemberRow(row) || (handle !== null && handle !== undefined && teamHandles.has(handle))
        )
      })
    : input.agents.filter((row) => !row.parentPaneKey || isMemberRow(row))
  const sourced = [
    ...rows.map((row) => ({ row, worktree: undefined })),
    ...(input.members ?? []).filter((one) => !rows.some((row) => row.paneKey === one.row.paneKey))
  ]
  const agents = sourced.map(({ row, worktree }) => {
    const agent: GameAgent = {
      ...gameAgentOf(row, leaderPaneKey, input.terminalHandleOf?.(row.paneKey) ?? null),
      ...(isMemberRow(row) || worktree ? { isMember: true } : {}),
      ...(worktree ? { worktree } : {})
    }
    const activity = activityOf(row.paneKey)
    return activity ? { ...agent, activity } : agent
  })
  const leaderActivity = input.leaderPaneKey ? activityOf(input.leaderPaneKey) : null
  return {
    config,
    sources: resolved.sources,
    // Why the scene file first: the mod's note shows only the first warning, and this one changes the art.
    warnings: [
      ...(sceneFile?.warning === undefined ? [] : [sceneFile.warning]),
      ...(project?.orchestratorGameWarnings ?? []),
      ...resolved.warnings,
      ...scenes.warnings
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
    review: gameReview,
    workItem,
    extensions: { scenes: sceneFile?.scene ? [sceneFile.scene, ...scenes.scenes] : scenes.scenes },
    links: gameLinksOf({
      review: gameReview,
      workItem,
      extra: [...projectLinks, ...activityGameLinksOf(agents)]
    }),
    ...(leaderActivity ? { activity: leaderActivity } : {}),
    ...(projectState ? { project: projectState } : {}),
    ...(actions.length > 0 ? { actions } : {})
  }
}
