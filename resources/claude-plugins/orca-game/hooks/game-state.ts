import type {
  GameActivity,
  GameAgent,
  GameCi,
  GameConfig,
  GameLink,
  GameReview,
  GameSceneExtension,
  GameState,
  GameWorkItem,
  GameWorktree
} from '../types'
import { isTerminalHandle } from './game-config'
import { httpUrlOf } from './http-url'
import { isQuestMode } from './quest-policy'
import { sceneDefinitionOf } from './scenes/scene-shape'

type Shape = Record<string, unknown>

const isShape = (value: unknown): value is Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  (allowed as readonly unknown[]).includes(value) ? (value as T) : undefined

const LINK_KINDS = ['review', 'ci', 'workItem', 'project', 'activity'] as const
const LINK_TONES = ['neutral', 'pending', 'success', 'danger'] as const
const MAX_LINKS = 32
const MAX_LINK_TEXT = 64

const AGENT_STATES = ['working', 'waiting', 'idle', 'done'] as const
const PROVIDERS = ['github', 'gitlab', 'bitbucket', 'azure-devops', 'gitea'] as const
const REVIEW_STATES = ['open', 'draft', 'merged', 'closed'] as const
const CI_STATES: readonly GameCi[] = ['pending', 'success', 'failure', 'neutral', 'none']
const TRACKERS = ['plane', 'jira', 'linear', 'github', 'gitlab'] as const
const STATUS_GROUPS = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
  'unknown'
] as const

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

const configOf = (value: unknown): Partial<GameConfig> => {
  const raw = isShape(value) ? value : {}
  const scene = str(raw.scene)?.trim() ?? ''
  return {
    ...(isQuestMode(raw.mode) ? { mode: raw.mode } : {}),
    ...(scene === '' ? {} : { scene }),
    ...(typeof raw.hud === 'boolean' ? { hud: raw.hud } : {}),
    ...(typeof raw.rewards === 'boolean' ? { rewards: raw.rewards } : {})
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
  return [
    {
      paneKey,
      displayName,
      agentType,
      state,
      toolName: str(value.toolName) ?? null,
      isLeader: value.isLeader === true,
      ...(isTerminalHandle(value.terminalHandle) ? { terminalHandle: value.terminalHandle } : {}),
      ...(activity === undefined ? {} : { activity })
    }
  ]
}

const reviewOf = (value: unknown): GameReview | null => {
  if (!isShape(value) || typeof value.number !== 'number') {
    return null
  }
  const provider = oneOf(value.provider, PROVIDERS)
  const state = oneOf(value.state, REVIEW_STATES)
  const url = str(value.url)
  if (provider === undefined || state === undefined || url === undefined) {
    return null
  }
  const ci = oneOf(value.ci, CI_STATES) ?? 'none'
  return { provider, number: value.number, title: str(value.title) ?? '', url, state, ci }
}

const workItemOf = (value: unknown): GameWorkItem | null => {
  if (!isShape(value)) {
    return null
  }
  const provider = oneOf(value.provider, TRACKERS)
  const statusGroup = oneOf(value.statusGroup, STATUS_GROUPS)
  const identifier = str(value.identifier)
  if (provider === undefined || statusGroup === undefined || identifier === undefined) {
    return null
  }
  return {
    provider,
    identifier,
    title: str(value.title) ?? '',
    url: str(value.url) ?? '',
    status: str(value.status) ?? '',
    statusGroup
  }
}

const MAX_SCENES = 256
// Orca namespaces a contributed id as `<pluginId>/<id>`, so it can never shadow a built-in scene.
const SCENE_ID = /^[a-z0-9-]+\.[a-z0-9-]+\/[a-z0-9-]+$/

const sceneOf = (value: unknown): GameSceneExtension[] => {
  if (!isShape(value)) {
    return []
  }
  const id = str(value.id)
  const pluginId = str(value.pluginId)
  if (id === undefined || pluginId === undefined || !SCENE_ID.test(id)) {
    return []
  }
  if (!id.startsWith(`${pluginId}/`)) {
    return []
  }
  const definition = sceneDefinitionOf(value.definition, id)
  return definition === undefined ? [] : [{ id, pluginId, definition }]
}

const extensionsOf = (value: unknown): GameState['extensions'] => {
  const scenes = isShape(value) && Array.isArray(value.scenes) ? value.scenes : []
  return { scenes: scenes.slice(0, MAX_SCENES).flatMap(sceneOf) }
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
    warnings: warnings.filter((one): one is string => typeof one === 'string'),
    worktree: worktreeOf(body.worktree),
    agents: Array.isArray(body.agents) ? body.agents.flatMap(agentOf) : [],
    review: reviewOf(body.review),
    workItem: workItemOf(body.workItem),
    extensions: extensionsOf(body.extensions),
    links: Array.isArray(body.links) ? body.links.slice(0, MAX_LINKS).flatMap(linkOf) : [],
    activity: activityOf(body.activity) ?? null
  }
}
