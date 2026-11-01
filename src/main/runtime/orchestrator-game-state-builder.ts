import { readWorktreeOrcaYaml } from '../worktree-orca-yaml'
import { gameFleetOf, liveLinkedItemOf, settle } from './orchestrator-game-fleet'
import { readSceneFileOrCarried } from './orchestrator-game-scene-file-read'
import { trackerWorkItemOf } from './orchestrator-game-lead-work-item'
import type { OrchestratorGameStateInput } from './orchestrator-game-state-input'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  resolveOrchestratorGameConfig,
  resolveOrchestratorGameIntegrations,
  resolveOrchestratorGameRewardWeights
} from '../../shared/orchestrator-game-config'
import { gameLeadOverPairedHostsOf } from './orchestrator-game-paired-hosts'
import { builtInGameActivityRules, gameActivityOf } from '../../shared/orchestrator-game-activity'
import { compileGameActivityRule } from '../../shared/orchestrator-game-integrations'
import { gameActionsOf, renderGameWorkPrompt } from '../../shared/orchestrator-game-actions'
import { gameListActionsOf, gameStateActionsOf } from '../../shared/orchestrator-game-lead-actions'
import {
  activityGameLinksOf,
  gameLinksOf,
  projectGameLinksOf
} from '../../shared/orchestrator-game-links'
import { orchestratorGameScenesOf } from '../../shared/orchestrator-game-scene'
import { desktopGameTimezoneOf } from '../../shared/orchestrator-game-render'
import { shownOrchestratorGameModeOf } from '../../shared/orchestrator-game-view'
import { orchestratorGameLocaleOf } from '../claude/orchestrator-game-launch'
import {
  gameReviewOf,
  type GameActivity,
  type OrchestratorGameState
} from '../../shared/orchestrator-game-state'
import { settleGameStop } from '../../shared/orchestrator-game-stop-state'

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
  const {
    readStop,
    readInboxes,
    readLeadElsewhere,
    readOpenOwnerQuestions,
    readGitHubBudget,
    readMetrics
  } = input
  const timezone = desktopGameTimezoneOf(resolved.config.timezone)
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
    githubBudget,
    merges,
    metrics
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
    readGitHubBudget ? settle(readGitHubBudget) : Promise.resolve(null),
    leadOnly(input.readMerges),
    leadOnly(readMetrics && (() => readMetrics(timezone)))
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
    timezone
  }
  const workItem =
    trackerWorkItemOf(plane, linear) ??
    (tracker
      ? await liveLinkedItemOf(input.worktree?.linkedWorkItem, input.readLinkedStatus)
      : null)
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
  const placed = await gameLeadOverPairedHostsOf(layers, input, role)
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
    found: input.callerParentPaneKey ? [] : input.found,
    leaderPaneKey: input.leaderPaneKey,
    teamHandles: input.teamHandles,
    terminalHandleOf: input.terminalHandleOf,
    activityOf,
    readMemberWork: input.readMemberWork,
    readLinkedStatus: input.readLinkedStatus,
    accountOf: input.accountOf,
    globalLoginOf: input.globalLoginOf,
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
    ...(merges ? { merges } : {}),
    ...(metrics ? { metrics } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    locale: orchestratorGameLocaleOf(input.settings?.uiLanguage, input.systemLocale ?? '')
  }
}
