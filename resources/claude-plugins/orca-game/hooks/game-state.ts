import type {
  GameAgent,
  GameCi,
  GameConfig,
  GameReview,
  GameState,
  GameWorkItem,
  GameWorktree
} from '../types'
import { isQuestMode } from './quest-policy'

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
  const displayName = str(value.displayName)
  const state = oneOf(value.state, AGENT_STATES)
  if (paneKey === undefined || displayName === undefined || state === undefined) {
    return []
  }
  return [
    {
      paneKey,
      displayName,
      agentType: str(value.agentType) ?? '',
      state,
      toolName: str(value.toolName) ?? null,
      isLeader: value.isLeader === true
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

// Orca's CLI may answer the bare state or wrap it as { result }; anything else is no data.
export const parseGameState = (stdout: string): GameState | undefined => {
  const parsed = parseJson(stdout)
  if (!isShape(parsed)) {
    return undefined
  }
  const body = 'result' in parsed ? parsed.result : parsed
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
    workItem: workItemOf(body.workItem)
  }
}
