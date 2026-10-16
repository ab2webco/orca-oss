import { loadHooks } from '../hooks'
import { resolveOrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import {
  orchestratorGameScenesOf,
  type OrchestratorGameSceneSource
} from '../../shared/orchestrator-game-scene'
import {
  gameAgentOf,
  gameReviewOf,
  statusGroupOfName,
  statusGroupOfPlane,
  type GameStatusGroup,
  type GameWorkItem,
  type OrchestratorGameState
} from '../../shared/orchestrator-game-state'
import type { GlobalSettings } from '../../shared/types'
import type { RuntimeWorktreeAgentRow } from '../../shared/runtime-types'
import type { WorkspaceLinkedItem } from '../../shared/worktree/types'

type TrackerItem = { identifier: string; title: string; url: string; stateName: string }

export type OrchestratorGameStateInput = {
  settings: Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'> | undefined
  worktree: {
    id: string
    repoId: string | null
    path: string
    branch: string
    displayName: string
    linkedWorkItem: WorkspaceLinkedItem | null | undefined
  } | null
  agents: Pick<
    RuntimeWorktreeAgentRow,
    'paneKey' | 'state' | 'agentType' | 'displayName' | 'taskTitle' | 'toolName'
  >[]
  leaderPaneKey: string | null
  terminalHandleOf?: (paneKey: string) => string | null
  readReview: () => Promise<Parameters<typeof gameReviewOf>[0]>
  readPlane: () => Promise<(TrackerItem & { stateGroup: string }) | null>
  readLinear: () => Promise<TrackerItem | null>
  readLinkedStatus?: (
    linked: WorkspaceLinkedItem
  ) => Promise<{ name: string; group?: GameStatusGroup } | null>
  readScenes?: () => Promise<OrchestratorGameSceneSource[]>
}

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

export async function buildOrchestratorGameState(
  input: OrchestratorGameStateInput
): Promise<OrchestratorGameState> {
  const project = input.worktree ? loadHooks(input.worktree.path) : null
  const resolved = resolveOrchestratorGameConfig({
    global: input.settings?.orchestratorGame,
    project: project?.orchestratorGame,
    local: input.worktree?.repoId
      ? input.settings?.orchestratorGameProjects?.[input.worktree.repoId]
      : undefined
  })
  const tracker = resolved.config.tracker && input.worktree !== null
  const readScenes = input.readScenes
  const [review, plane, linear, sceneSources] = await Promise.all([
    input.worktree ? settle(input.readReview) : Promise.resolve(null),
    tracker ? settle(input.readPlane) : Promise.resolve(null),
    tracker ? settle(input.readLinear) : Promise.resolve(null),
    readScenes ? settle(readScenes) : Promise.resolve(null)
  ])
  const scenes = orchestratorGameScenesOf(sceneSources ?? [])
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
  return {
    config: resolved.config,
    sources: resolved.sources,
    warnings: [...(project?.orchestratorGameWarnings ?? []), ...scenes.warnings],
    worktree: input.worktree
      ? {
          id: input.worktree.id,
          path: input.worktree.path,
          branch: input.worktree.branch,
          displayName: input.worktree.displayName
        }
      : null,
    agents: input.agents.map((row) =>
      gameAgentOf(row, input.leaderPaneKey, input.terminalHandleOf?.(row.paneKey) ?? null)
    ),
    review: gameReviewOf(review),
    workItem,
    extensions: { scenes: scenes.scenes }
  }
}
