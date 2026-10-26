import type { GameCi, GameReview, GameWorkItem } from '../types'

// Shapes shared by the state's own review and work item and by each member's.

export type Shape = Record<string, unknown>

export const isShape = (value: unknown): value is Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

export const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  (allowed as readonly unknown[]).includes(value) ? (value as T) : undefined

const PROVIDERS = ['github', 'gitlab', 'bitbucket', 'azure-devops', 'gitea'] as const
const REVIEW_STATES = ['open', 'draft', 'merged', 'closed'] as const
const CI_STATES: readonly GameCi[] = ['pending', 'success', 'failure', 'neutral', 'none']
const TRACKERS = ['plane', 'jira', 'linear', 'github', 'gitlab'] as const
export const STATUS_GROUPS = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
  'unknown'
] as const

export const reviewOf = (value: unknown): GameReview | null => {
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
  return {
    provider,
    number: value.number,
    title: str(value.title) ?? '',
    url,
    state,
    ci,
    ...(typeof value.perfectMerge === 'boolean' ? { perfectMerge: value.perfectMerge } : {})
  }
}

export const workItemOf = (value: unknown): GameWorkItem | null => {
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
