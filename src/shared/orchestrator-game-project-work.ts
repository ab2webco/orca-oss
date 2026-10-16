import type { CheckStatus, GitHubRepositoryIdentity } from './github/pull-request-types'
import {
  GAME_PROMPT_MAX,
  GAME_WORK_PROMPT_PLACEHOLDERS,
  unknownPlaceholderOf
} from './orchestrator-game-actions'
import { isHttpUrl } from './orchestrator-game-integrations'
import type { GameLinkTone, GameStatusGroup } from './orchestrator-game-state'

/** Project-wide work the band shows next to the worktree's own: my open PRs and my open tickets. */

export const GAME_PROJECT_ITEMS_MAX = 5
/** Why more than the Panel draws: `orca game wave` picks its tickets from these. Older mods cut at 5. */
export const GAME_TODO_ITEMS_MAX = 30
const GAME_TODO_TEXT_MAX = 64

export const GAME_TODO_PROVIDERS = ['plane', 'jira', 'linear', 'github', 'gitlab'] as const
export type GameTodoProvider = (typeof GAME_TODO_PROVIDERS)[number]

/** Where the To Do comes from; `project` is a Plane project id, Jira key or Linear team key. */
export type OrchestratorGameTodoSource =
  | 'off'
  | {
      provider: GameTodoProvider
      project?: string
      workspace?: string
      /** What "work on" sends the lead: `{id}`, `{title}`, `{url}`, `{status}`. */
      workPrompt?: string
      /** An action's command or id the To Do link runs instead of opening the list. */
      action?: string
    }

export type GameProjectItem = {
  id: string
  title: string
  url: string
  status?: string
  tone?: GameLinkTone
  /** A ticket's status group, so the Panel can head in-progress, QA and to-do apart. */
  group?: GameStatusGroup
  /** What "work on" sends the lead for this ticket. */
  prompt?: string
}

/** `total` counts every open item; `items` keeps the first few, `url` opens the full list. */
export type GameProjectList = {
  provider: string
  total: number
  url: string | null
  items: GameProjectItem[]
  /** Open tickets per status group, all of them and not only the items kept. */
  groups?: Partial<Record<GameStatusGroup, number>>
  /** The `game.state` action the To Do link runs instead of opening `url`. */
  actionId?: string
}

export type GameProjectWork = { reviews: GameProjectList | null; todo: GameProjectList | null }

const JIRA_PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,31}$/
const TODO_ACTION = /^[a-z][a-z0-9:-]{0,63}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTodoProvider = (value: unknown): value is GameTodoProvider =>
  typeof value === 'string' && (GAME_TODO_PROVIDERS as readonly string[]).includes(value)

/** How the band's PR list behaves; `action` names one it runs instead of opening the list. */
export type OrchestratorGameReviewsSource = { action?: string }

export function parseGameReviewsSource(raw: unknown): {
  value: OrchestratorGameReviewsSource | undefined
  warnings: string[]
} {
  if (!isRecord(raw)) {
    return { value: undefined, warnings: ['orchestratorGame.reviews must be a mapping'] }
  }
  const value: OrchestratorGameReviewsSource = {}
  const warnings: string[] = []
  for (const [key, entry] of Object.entries(raw)) {
    const action = typeof entry === 'string' ? entry.trim() : ''
    if (key !== 'action') {
      warnings.push(`orchestratorGame.reviews.${key} is not a known setting`)
    } else if (TODO_ACTION.test(action)) {
      value.action = action
    } else {
      warnings.push(
        'orchestratorGame.reviews.action must name an action by its command or id, like prs'
      )
    }
  }
  return { value, warnings }
}

export function parseGameTodoSource(raw: unknown): {
  value: OrchestratorGameTodoSource | undefined
  warnings: string[]
} {
  const refuse = (warning: string) => ({ value: undefined, warnings: [warning] })
  if (raw === 'off') {
    return { value: 'off', warnings: [] }
  }
  if (!isRecord(raw)) {
    return refuse('orchestratorGame.todo must be off or a mapping with provider')
  }
  if (!isTodoProvider(raw.provider)) {
    return refuse(`orchestratorGame.todo.provider must be one of ${GAME_TODO_PROVIDERS.join(', ')}`)
  }
  const source: Exclude<OrchestratorGameTodoSource, 'off'> = { provider: raw.provider }
  for (const key of ['project', 'workspace'] as const) {
    if (raw[key] === undefined) {
      continue
    }
    const text = typeof raw[key] === 'string' ? raw[key].trim() : ''
    if (text.length === 0 || text.length > GAME_TODO_TEXT_MAX) {
      return refuse(`orchestratorGame.todo.${key} must be 1 to ${GAME_TODO_TEXT_MAX} characters`)
    }
    source[key] = text
  }
  // Why: the key is spliced into JQL, so anything but a project key could widen the query.
  if (source.provider === 'jira' && source.project && !JIRA_PROJECT_KEY.test(source.project)) {
    return refuse('orchestratorGame.todo.project must be a Jira project key like CIN')
  }
  if (raw.workPrompt !== undefined) {
    const workPrompt = typeof raw.workPrompt === 'string' ? raw.workPrompt.trim() : ''
    if (workPrompt.length === 0 || workPrompt.length > GAME_PROMPT_MAX) {
      return refuse(`orchestratorGame.todo.workPrompt must be 1 to ${GAME_PROMPT_MAX} characters`)
    }
    const unknown = unknownPlaceholderOf(workPrompt, GAME_WORK_PROMPT_PLACEHOLDERS)
    if (unknown !== null) {
      return refuse(`orchestratorGame.todo.workPrompt uses an unknown placeholder {${unknown}}`)
    }
    source.workPrompt = workPrompt
  }
  if (raw.action === undefined) {
    return { value: source, warnings: [] }
  }
  // Why keep the rest: a mistyped action should cost the shortcut, never the To Do itself.
  const action = typeof raw.action === 'string' ? raw.action.trim() : ''
  if (!TODO_ACTION.test(action)) {
    return {
      value: source,
      warnings: ['orchestratorGame.todo.action must name an action by its command or id, like jira']
    }
  }
  return { value: { ...source, action }, warnings: [] }
}

// Why this order: what is being worked on first, then what waits on QA, then what is next.
const GROUP_ORDER: readonly GameStatusGroup[] = [
  'in_progress',
  'review',
  'todo',
  'backlog',
  'unknown',
  'done',
  'cancelled'
]

const groupRankOf = (item: GameProjectItem): number =>
  item.group === undefined ? GROUP_ORDER.length : GROUP_ORDER.indexOf(item.group)

export function gameProjectListOf(
  provider: string,
  items: readonly GameProjectItem[],
  url: string | null,
  total: number = items.length,
  max: number = GAME_PROJECT_ITEMS_MAX
): GameProjectList {
  const grouped = items.filter((one) => one.group !== undefined)
  const groups: Partial<Record<GameStatusGroup, number>> = {}
  for (const one of grouped) {
    if (one.group !== undefined) {
      groups[one.group] = (groups[one.group] ?? 0) + 1
    }
  }
  return {
    provider,
    total,
    url: url !== null && isHttpUrl(url) ? url : null,
    items: items
      .filter((one) => isHttpUrl(one.url))
      .sort((left, right) => groupRankOf(left) - groupRankOf(right))
      .slice(0, max),
    ...(grouped.length > 0 ? { groups } : {})
  }
}

export const reviewToneOf = (ci: CheckStatus | 'none'): GameLinkTone =>
  ci === 'failure'
    ? 'danger'
    : ci === 'pending'
      ? 'pending'
      : ci === 'success'
        ? 'success'
        : 'neutral'

export const todoToneOf = (group: GameStatusGroup): GameLinkTone =>
  group === 'in_progress' ? 'pending' : group === 'review' ? 'success' : 'neutral'

type ListUrlSource = {
  provider: string
  repo?: GitHubRepositoryIdentity | null
  /** Every repo the PRs were searched in, e.g. a fork and its upstream. */
  repos?: readonly GitHubRepositoryIdentity[]
  sampleUrl?: string | null
  project?: string
}

const githubBase = (repo: GitHubRepositoryIdentity): string =>
  `https://${repo.host ?? 'github.com'}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`

const parsedUrl = (value: string | null | undefined): URL | null => {
  if (!value || !isHttpUrl(value)) {
    return null
  }
  return new URL(value)
}

// Why cut at `/-/`: a GitLab project path can nest groups, and `/-/` always ends it.
const gitlabProjectOf = (sampleUrl: string | null | undefined): string | null => {
  const url = parsedUrl(sampleUrl)
  const at = url?.pathname.indexOf('/-/') ?? -1
  return url && at > 0 ? `${url.origin}${url.pathname.slice(0, at)}` : null
}

const MY_OPEN_PRS = 'is:pr is:open author:@me'

export function reviewsListUrlOf(source: ListUrlSource): string | null {
  const repos = source.repos ?? []
  if (source.provider === 'github' && repos.length > 1) {
    const scope = repos.map((one) => `repo:${one.owner}/${one.repo}`).join(' ')
    const host = repos[0]?.host ?? 'github.com'
    return `https://${host}/pulls?q=${encodeURIComponent(`${MY_OPEN_PRS} ${scope}`)}`
  }
  const repo = repos[0] ?? source.repo
  if (source.provider === 'github' && repo) {
    return `${githubBase(repo)}/pulls?q=${encodeURIComponent(MY_OPEN_PRS)}`
  }
  if (source.provider === 'gitlab') {
    const project = gitlabProjectOf(source.sampleUrl)
    return project ? `${project}/-/merge_requests?state=opened` : null
  }
  return null
}

export function todoListUrlOf(source: ListUrlSource): string | null {
  if (source.provider === 'github') {
    return source.repo
      ? `${githubBase(source.repo)}/issues?q=${encodeURIComponent('is:issue is:open assignee:@me')}`
      : null
  }
  if (source.provider === 'gitlab') {
    const project = gitlabProjectOf(source.sampleUrl)
    return project ? `${project}/-/issues?state=opened` : null
  }
  const url = parsedUrl(source.sampleUrl)
  const first = url?.pathname.split('/').find((part) => part !== '')
  if (!url) {
    return null
  }
  if (source.provider === 'plane') {
    return first ? `${url.origin}/${first}/workspace-views/assigned/` : null
  }
  if (source.provider === 'linear') {
    return first ? `${url.origin}/${first}/my-issues/assigned` : null
  }
  if (source.provider === 'jira') {
    const scope = source.project ? `project = ${source.project} AND ` : ''
    const jql = `${scope}assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`
    return `${url.origin}/issues/?jql=${encodeURIComponent(jql)}`
  }
  return null
}
