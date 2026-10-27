import type {
  GameActivity,
  GameAgent,
  GameMemberWorktree,
  GameConfig,
  GameLink,
  GameLocale,
  GameProjectItem,
  GameProjectList,
  GameProjectWork,
  GameSceneExtension,
  GameState,
  GameStatusGroup,
  GameWorktree
} from '../types'
import { gameActionsOf, gamePromptOf } from './game-action-shape'
import { gameLeadOf } from './game-lead'
import { rewardWeightsOf } from './rewards'
import { gameSourcesOf } from './game-sources'
import { isTerminalHandle } from './game-config'
import { lookConfigOf } from './game-render'
import { isGameViewId } from './game-view'
import { httpUrlOf } from './http-url'
import { isQuestMode } from './quest-policy'
import { isShape, oneOf, reviewOf, STATUS_GROUPS, str, workItemOf } from './game-state-shapes'
import { sceneDefinitionOf } from './scenes/scene-shape'
import { memberAccountOf, memberLimitOf, memberRemoteOf } from './member-tags'
import { memberAdvisorOf, memberLaunchOf } from './member-advisor'
import { GAME_LOCALES } from './game-strings'

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const LINK_KINDS = ['review', 'ci', 'workItem', 'project', 'activity'] as const
const LINK_TONES = ['neutral', 'pending', 'success', 'danger'] as const
const MAX_LINKS = 32
const MAX_LINK_TEXT = 64

const AGENT_STATES = ['working', 'waiting', 'idle', 'done'] as const

const textOf = (value: unknown): string | undefined => {
  const text = str(value)?.trim().slice(0, MAX_LINK_TEXT)
  return text === undefined || text === '' ? undefined : text
}

const activityOf = (value: unknown): GameActivity | undefined => {
  if (!isShape(value) || typeof value.at !== 'number') {
    return undefined
  }
  const name = textOf(value.name)
  const id = textOf(value.id)
  const url = httpUrlOf(value.url)
  if (name === undefined || id === undefined || url === undefined) {
    return undefined
  }
  return { name, id, url, at: value.at, running: value.running === true }
}

const linkOf = (value: unknown): GameLink[] => {
  if (!isShape(value)) {
    return []
  }
  const id = textOf(value.id)
  const kind = oneOf(value.kind, LINK_KINDS)
  const label = textOf(value.label)
  const url = httpUrlOf(value.url)
  if (id === undefined || kind === undefined || label === undefined || url === undefined) {
    return []
  }
  const status = textOf(value.status)
  const tone = oneOf(value.tone, LINK_TONES)
  return [
    {
      id,
      kind,
      provider: textOf(value.provider) ?? '',
      label,
      url,
      ...(status === undefined ? {} : { status }),
      ...(tone === undefined ? {} : { tone })
    }
  ]
}

// Why 30: Orca sends the To Do the lead waves from; the Panel draws only a few per section.
const MAX_PROJECT_ITEMS = 30

const projectItemOf = (value: unknown): GameProjectItem[] => {
  if (!isShape(value)) {
    return []
  }
  const id = textOf(value.id)
  const url = httpUrlOf(value.url)
  if (id === undefined || url === undefined) {
    return []
  }
  const status = textOf(value.status)
  const tone = oneOf(value.tone, LINK_TONES)
  const group = oneOf(value.group, STATUS_GROUPS)
  const prompt = gamePromptOf(value.prompt)
  return [
    {
      id,
      title: textOf(value.title) ?? '',
      url,
      ...(status === undefined ? {} : { status }),
      ...(tone === undefined ? {} : { tone }),
      ...(group === undefined ? {} : { group }),
      ...(prompt === undefined ? {} : { prompt })
    }
  ]
}

const groupCountsOf = (value: unknown): { groups?: Partial<Record<GameStatusGroup, number>> } => {
  if (!isShape(value)) {
    return {}
  }
  const counts = STATUS_GROUPS.flatMap((group) => {
    const count = value[group]
    return typeof count === 'number' && Number.isInteger(count) && count >= 0
      ? [[group, count] as const]
      : []
  })
  return counts.length === 0 ? {} : { groups: Object.fromEntries(counts) }
}

const ACTION_ID_MAX = 64

const actionIdOf = (value: unknown): { actionId?: string } =>
  typeof value === 'string' && value.trim() !== '' && value.trim().length <= ACTION_ID_MAX
    ? { actionId: value.trim() }
    : {}

const projectListOf = (value: unknown): GameProjectList | null => {
  if (!isShape(value) || typeof value.total !== 'number' || !Number.isFinite(value.total)) {
    return null
  }
  const items = Array.isArray(value.items) ? value.items : []
  return {
    provider: textOf(value.provider) ?? '',
    total: Math.max(0, Math.floor(value.total)),
    url: httpUrlOf(value.url) ?? null,
    items: items.flatMap(projectItemOf).slice(0, MAX_PROJECT_ITEMS),
    ...groupCountsOf(value.groups),
    ...actionIdOf(value.actionId)
  }
}

const projectWorkOf = (value: unknown): { project?: GameProjectWork } =>
  isShape(value)
    ? { project: { reviews: projectListOf(value.reviews), todo: projectListOf(value.todo) } }
    : {}

const configOf = (value: unknown): Partial<GameConfig> => {
  const raw = isShape(value) ? value : {}
  const scene = str(raw.scene)?.trim() ?? ''
  return {
    ...(isQuestMode(raw.mode) ? { mode: raw.mode } : {}),
    ...(scene === '' ? {} : { scene }),
    ...(typeof raw.hud === 'boolean' ? { hud: raw.hud } : {}),
    ...(typeof raw.rewards === 'boolean' ? { rewards: raw.rewards } : {}),
    ...(raw.openLinks === 'orca' || raw.openLinks === 'system' ? { openLinks: raw.openLinks } : {}),
    ...lookConfigOf(raw)
  }
}

const worktreeOf = (value: unknown): GameWorktree | null => {
  if (!isShape(value) || str(value.id) === undefined) {
    return null
  }
  return {
    id: str(value.id) ?? '',
    path: str(value.path) ?? '',
    branch: str(value.branch) ?? '',
    displayName: str(value.displayName) ?? ''
  }
}

const memberWorktreeOf = (value: unknown): GameMemberWorktree | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const id = str(value.id)
  const branch = str(value.branch)
  const displayName = str(value.displayName)
  return id && branch !== undefined && displayName !== undefined
    ? { id, branch, displayName }
    : undefined
}

const agentOf = (value: unknown): GameAgent[] => {
  if (!isShape(value)) {
    return []
  }
  const paneKey = str(value.paneKey)
  const state = oneOf(value.state, AGENT_STATES)
  if (paneKey === undefined || state === undefined) {
    return []
  }
  const agentType = str(value.agentType) ?? ''
  // Orca sends null for a pane with no title or task yet; it is still on the team.
  const displayName = str(value.displayName) || agentType || paneKey
  const activity = activityOf(value.activity)
  const worktree = memberWorktreeOf(value.worktree)
  const review = worktree ? reviewOf(value.review) : null
  const workItem = worktree ? workItemOf(value.workItem) : null
  const limit = memberLimitOf(value.limit)
  const account = memberAccountOf(value.account)
  const advisor = memberAdvisorOf(value.advisor)
  const launch = memberLaunchOf(value.launch)
  const remote = memberRemoteOf(value.remote)
  return [
    {
      paneKey,
      displayName,
      agentType,
      state,
      toolName: str(value.toolName) ?? null,
      isLeader: value.isLeader === true,
      ...(isTerminalHandle(value.terminalHandle) ? { terminalHandle: value.terminalHandle } : {}),
      ...(activity === undefined ? {} : { activity }),
      ...(value.isMember === true ? { isMember: true } : {}),
      ...(worktree === undefined ? {} : { worktree }),
      ...(review === null ? {} : { review }),
      ...(workItem === null ? {} : { workItem }),
      ...(limit === undefined ? {} : { limit }),
      ...(account === undefined ? {} : { account }),
      ...(advisor === undefined ? {} : { advisor }),
      ...(launch === undefined ? {} : { launch }),
      ...(remote === undefined ? {} : { remote })
    }
  ]
}

const MAX_SCENES = 256
// Orca namespaces a contributed id as `<pluginId>/<id>`, so it can never shadow a built-in scene.
const SCENE_ID = /^[a-z0-9-]+\.[a-z0-9-]+\/[a-z0-9-]+$/
// A project's own scene file arrives as `file:<path in the worktree>` from the `file` source.
const FILE_SCENE_SOURCE = 'file'
const MAX_FILE_SCENE_PATH = 512
const isFileSceneId = (id: string): boolean => {
  const path = id.startsWith('file:') ? id.slice('file:'.length) : ''
  return (
    path.length > 0 &&
    path.length <= MAX_FILE_SCENE_PATH &&
    [...path].every((one) => (one.codePointAt(0) ?? 0) > 0x1f && one !== '\u007f')
  )
}

const sceneOf = (value: unknown): GameSceneExtension[] => {
  if (!isShape(value)) {
    return []
  }
  const id = str(value.id)
  const pluginId = str(value.pluginId)
  if (id === undefined || pluginId === undefined) {
    return []
  }
  const isFile = pluginId === FILE_SCENE_SOURCE && isFileSceneId(id)
  if (!isFile && !(SCENE_ID.test(id) && id.startsWith(`${pluginId}/`))) {
    return []
  }
  const definition = sceneDefinitionOf(value.definition, id)
  return definition === undefined ? [] : [{ id, pluginId, definition }]
}

const extensionsOf = (value: unknown): GameState['extensions'] => {
  const scenes = isShape(value) && Array.isArray(value.scenes) ? value.scenes : []
  return { scenes: scenes.slice(0, MAX_SCENES).flatMap(sceneOf) }
}

const localeOf = (value: unknown): { locale?: GameLocale } => {
  const locale = GAME_LOCALES.find((one) => one === value)
  return locale === undefined ? {} : { locale }
}

// Why filtered: a newer Orca may add scopes or views this mod cannot store or draw.
const viewSwitchOf = (
  body: Record<string, unknown>
): Pick<GameState, 'viewScopes' | 'suggestedView'> => {
  const scopes = Array.isArray(body.viewScopes)
    ? body.viewScopes.filter(
        (one): one is 'project' | 'global' => one === 'project' || one === 'global'
      )
    : undefined
  return {
    ...(scopes === undefined ? {} : { viewScopes: scopes }),
    ...(isGameViewId(body.suggestedView) ? { suggestedView: body.suggestedView } : {})
  }
}

// Orca's CLI may answer the bare state or wrap it as { result }; anything else is no data.
export const parseGameState = (stdout: string): GameState | undefined => {
  const parsed = parseJson(stdout)
  if (!isShape(parsed)) {
    return undefined
  }
  return gameStateOf('result' in parsed ? parsed.result : parsed)
}

/** A game state from any value, such as one an older version of the mod stored. */
export const gameStateOf = (body: unknown): GameState | undefined => {
  if (!isShape(body)) {
    return undefined
  }
  const warnings = Array.isArray(body.warnings) ? body.warnings : []
  return {
    config: configOf(body.config),
    ...gameSourcesOf(body.sources),
    warnings: warnings.filter((one): one is string => typeof one === 'string'),
    worktree: worktreeOf(body.worktree),
    agents: Array.isArray(body.agents) ? body.agents.flatMap(agentOf) : [],
    review: reviewOf(body.review),
    workItem: workItemOf(body.workItem),
    extensions: extensionsOf(body.extensions),
    links: Array.isArray(body.links) ? body.links.slice(0, MAX_LINKS).flatMap(linkOf) : [],
    activity: activityOf(body.activity) ?? null,
    ...projectWorkOf(body.project),
    ...gameActionsOf(body.actions),
    ...gameLeadOf(body),
    ...rewardWeightsOf(body.rewardWeights),
    ...localeOf(body.locale),
    ...viewSwitchOf(body)
  }
}
