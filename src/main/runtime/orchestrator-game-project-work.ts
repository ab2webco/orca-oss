import type { GitHubRepositoryIdentity } from '../../shared/github/pull-request-types'
import type { GitHubWorkItem } from '../../shared/github/work-item-types'
import type { GitLabWorkItem } from '../../shared/gitlab-types'
import type { JiraIssue } from '../../shared/jira-types'
import type { LinearIssue } from '../../shared/linear/issue-types'
import type { PlaneWorkItem } from '../../shared/plane-types'
import { gameCacheTtlMs, type GameCacheTtl } from './orchestrator-game-read-cache'
import {
  readGitHubQueue,
  readGitHubReviews,
  readGitLabReviews,
  type GameProjectReviewsPort
} from './orchestrator-game-project-reviews'
import {
  GAME_TODO_ITEMS_MAX,
  gameProjectListOf,
  jiraScopeOf,
  keysOfProject,
  todoListUrlOf,
  todoToneOf,
  type GameProjectItem,
  type GameProjectList,
  type GameProjectWork,
  type GameTodoProvider,
  type OrchestratorGameTodoSource
} from '../../shared/orchestrator-game-project-work'
import {
  statusGroupOfJira,
  statusGroupOfName,
  statusGroupOfPlane,
  type GameStatusGroup,
  type GameWorkItem
} from '../../shared/orchestrator-game-state'

import { mergeTodoLists, todoSourcesOf, type TodoSource } from './orchestrator-game-todo-sources'

/** The provider calls the band's project lists need; each one may throw. */
export type GameProjectWorkPort = GameProjectReviewsPort & {
  /** Null when the repo has no GitHub remote. */
  githubRepo: () => Promise<GitHubRepositoryIdentity | null>
  githubIssues: () => Promise<readonly Pick<GitHubWorkItem, 'number' | 'title' | 'url'>[]>
  gitlabIssues: () => Promise<readonly Pick<GitLabWorkItem, 'number' | 'title' | 'url'>[]>
  /** The open items in one fetch, with the viewer they are read for (null when unknown). */
  planeOpen: (args: { project?: string; workspace?: string }) => Promise<{
    viewerId: string | null
    items: readonly PlaneTodoItem[]
  }>
  jiraSearch: (
    jql: string,
    site?: string
  ) => Promise<readonly Pick<JiraIssue, 'key' | 'title' | 'url' | 'status'>[]>
  linearAssigned: (
    workspace?: string
  ) => Promise<readonly Pick<LinearIssue, 'identifier' | 'title' | 'url' | 'state' | 'team'>[]>
}

type PlaneTodoItem = Pick<PlaneWorkItem, 'identifier' | 'title' | 'url' | 'state'> & {
  assignees?: readonly { id: string }[]
}

// Why: a tracker that is offline, unauthenticated or rate limited costs its own list, never the other.
const settle = <T>(read: () => Promise<T>): Promise<T | null> => read().catch(() => null)

const sameRepo = (left: GitHubRepositoryIdentity, right: GitHubRepositoryIdentity): boolean =>
  left.owner.toLowerCase() === right.owner.toLowerCase() &&
  left.repo.toLowerCase() === right.repo.toLowerCase()

type MyOpenPrsSearch<T> = {
  items: readonly T[]
  sources: {
    prs: GitHubRepositoryIdentity | null
    upstreamCandidate: GitHubRepositoryIdentity | null
  }
}

/** My open PRs in a repo and, for a fork, its upstream: own work on the fork, contributions upstream. */
export async function myOpenPullRequestsOf<T extends { type: string }>(
  search: (preference: 'upstream' | 'origin') => Promise<MyOpenPrsSearch<T>>
): Promise<{ repos: GitHubRepositoryIdentity[]; items: T[] }> {
  // Why (ORCA-1148): the worktree's own repo is searched first; upstream only when it is another repo.
  const own = await search('origin')
  const searched = own.sources.prs
  const upstream = own.sources.upstreamCandidate
  const parent =
    upstream && (!searched || !sameRepo(upstream, searched)) ? await search('upstream') : null
  const results = (parent ? [own, parent] : [own]).map((one) => ({
    repo: one.sources.prs,
    prs: one.items.filter((item) => item.type === 'pr')
  }))
  // Why: a repo without my PRs would widen the link into a global search; none leaves it on the project.
  return {
    repos: results.flatMap((one) => (one.repo && one.prs.length > 0 ? [one.repo] : [])),
    items: results.flatMap((one) => one.prs)
  }
}

/** A Plane workspace named by its slug, as a shared orca.yaml writes it, or by Orca's id for it. */
export const planeWorkspaceIdOf = (
  workspaces: readonly { id: string; workspaceSlug: string }[],
  value: string | undefined
): string | undefined =>
  value === undefined
    ? undefined
    : (workspaces.find((one) => one.id === value || one.workspaceSlug === value)?.id ?? value)

const DONE_PLANE_GROUPS = new Set(['completed', 'cancelled'])

/** My open items and, in a known project, its unstarted ones whoever holds them (ORCA-1168). */
const planeTodoOf = (
  items: readonly PlaneTodoItem[],
  viewerId: string | null,
  projectKnown: boolean
): PlaneTodoItem[] =>
  items.filter((one) => {
    if (DONE_PLANE_GROUPS.has(one.state.group)) {
      return false
    }
    // Why null reads as mine: like Plane's own assigned filter, no viewer degrades to every open item.
    const mine = viewerId === null || one.assignees?.some((who) => who.id === viewerId) === true
    return mine || (projectKnown && one.state.group === 'unstarted')
  })

const ticketOf = (
  id: string,
  one: { title: string; url: string },
  status: string,
  group: GameStatusGroup
): GameProjectItem => ({
  id,
  title: one.title,
  url: one.url,
  status,
  tone: todoToneOf(group),
  group
})

async function readTodo(
  port: GameProjectWorkPort,
  source: TodoSource,
  repo: GitHubRepositoryIdentity | null
): Promise<GameProjectList> {
  const listOf = (provider: GameTodoProvider, items: GameProjectItem[], url?: string | null) =>
    gameProjectListOf(
      provider,
      items,
      url ??
        todoListUrlOf({
          provider,
          sampleUrl: items[0]?.url ?? null,
          project: typeof source.project === 'string' ? source.project : undefined,
          repo
        }),
      items.length,
      GAME_TODO_ITEMS_MAX
    )
  switch (source.provider) {
    case 'plane': {
      const project = typeof source.project === 'string' ? source.project : undefined
      const read = await port.planeOpen({ project, workspace: source.workspace })
      const open = planeTodoOf(read.items, read.viewerId, project !== undefined)
      return listOf(
        'plane',
        open.map((one) =>
          ticketOf(
            one.identifier,
            one,
            one.state.name,
            statusGroupOfPlane(one.state.group, one.state.name)
          )
        )
      )
    }
    case 'jira': {
      const scope = jiraScopeOf(source.project)
      const jql = `${scope}assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`
      const issues = await port.jiraSearch(jql, source.workspace)
      return listOf(
        'jira',
        issues.map((one) =>
          ticketOf(
            one.key,
            one,
            one.status.name,
            statusGroupOfJira(one.status.categoryKey, one.status.name)
          )
        )
      )
    }
    case 'linear': {
      const issues = (await port.linearAssigned(source.workspace)).filter(
        (one) => !source.project || keysOfProject(source.project).includes(one.team.key)
      )
      return listOf(
        'linear',
        issues.map((one) =>
          ticketOf(one.identifier, one, one.state.name, statusGroupOfName(one.state.name))
        )
      )
    }
    case 'github': {
      const issues = await port.githubIssues()
      return listOf(
        'github',
        issues.map((one) => ticketOf(`#${one.number}`, one, 'Open', 'todo')),
        todoListUrlOf({ provider: 'github', repo })
      )
    }
    case 'gitlab': {
      const issues = await port.gitlabIssues()
      return listOf(
        'gitlab',
        issues.map((one) => ticketOf(`#${one.number}`, one, 'Open', 'todo'))
      )
    }
  }
}

export async function readGameProjectWork(
  port: GameProjectWorkPort,
  args: {
    todo: OrchestratorGameTodoSource | null
    workItem: Pick<GameWorkItem, 'provider' | 'identifier'> | null
    planeProject?: string | null
  }
): Promise<GameProjectWork> {
  const repo = await settle(port.githubRepo)
  const reviews = await settle(() =>
    repo ? readGitHubReviews(port, repo) : readGitLabReviews(port)
  )
  const host = repo ? 'github' : reviews?.provider === 'gitlab' ? 'gitlab' : null
  const sources =
    args.todo === 'off'
      ? []
      : todoSourcesOf({
          configured: args.todo,
          planeProject: args.planeProject ?? null,
          workItem: args.workItem,
          host
        })
  const todo =
    sources.length > 0
      ? mergeTodoLists(
          await Promise.all(sources.map((source) => settle(() => readTodo(port, source, repo))))
        )
      : null
  const queue = repo ? await readGitHubQueue(port) : null
  return { reviews, todo, ...(queue ? { queue } : {}) }
}

const CACHE_MAX_ENTRIES = 32

/** One load per key and TTL, shared by concurrent reads, so polling never multiplies provider calls. */
export class GameProjectWorkCache {
  private readonly entries = new Map<string, { at: number; value: Promise<GameProjectWork> }>()

  constructor(
    private readonly ttlMs: GameCacheTtl,
    private readonly now: () => number = Date.now
  ) {}

  read(key: string, load: () => Promise<GameProjectWork>): Promise<GameProjectWork> {
    const at = this.now()
    const cached = this.entries.get(key)
    if (cached && at - cached.at < gameCacheTtlMs(this.ttlMs)) {
      return cached.value
    }
    const value = load().catch(() => ({ reviews: null, todo: null }))
    this.entries.delete(key)
    this.entries.set(key, { at, value })
    if (this.entries.size > CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) {
        this.entries.delete(oldest)
      }
    }
    return value
  }
}
