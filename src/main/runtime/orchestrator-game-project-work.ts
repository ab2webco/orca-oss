import type { PRCheckDetail } from '../../shared/github/check-types'
import type { CheckStatus, GitHubRepositoryIdentity } from '../../shared/github/pull-request-types'
import type { GitHubWorkItem } from '../../shared/github/work-item-types'
import type { GitLabWorkItem } from '../../shared/gitlab-types'
import type { JiraIssue } from '../../shared/jira-types'
import type { LinearIssue } from '../../shared/linear/issue-types'
import type { PlaneWorkItem } from '../../shared/plane-types'
import { derivePRCheckStatus } from '../../shared/pr-check-status'
import { gameCacheTtlMs, type GameCacheTtl } from './orchestrator-game-read-cache'
import {
  GAME_PROJECT_ITEMS_MAX,
  GAME_TODO_ITEMS_MAX,
  gameProjectListOf,
  reviewsListUrlOf,
  reviewToneOf,
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

type TodoSource = Exclude<OrchestratorGameTodoSource, 'off'>
type PullRequest = Pick<GitHubWorkItem, 'number' | 'title' | 'url' | 'headSha' | 'prRepo'>

/** The provider calls the band's project lists need; each one may throw. */
export type GameProjectWorkPort = {
  /** Null when the repo has no GitHub remote. */
  githubRepo: () => Promise<GitHubRepositoryIdentity | null>
  /** My open PRs and the repos holding them, out of a fork and its upstream when it has one. */
  githubPullRequests: () => Promise<{
    repos: readonly GitHubRepositoryIdentity[]
    items: readonly PullRequest[]
  }>
  githubChecks: (pr: PullRequest) => Promise<readonly PRCheckDetail[]>
  githubIssues: () => Promise<readonly Pick<GitHubWorkItem, 'number' | 'title' | 'url'>[]>
  /** Null when the repo is not a GitLab project. */
  gitlabMergeRequests: () => Promise<
    readonly Pick<GitLabWorkItem, 'number' | 'title' | 'url' | 'state'>[] | null
  >
  gitlabIssues: () => Promise<readonly Pick<GitLabWorkItem, 'number' | 'title' | 'url'>[]>
  planeAssigned: (args: {
    project?: string
    workspace?: string
  }) => Promise<readonly Pick<PlaneWorkItem, 'identifier' | 'title' | 'url' | 'state'>[]>
  jiraSearch: (
    jql: string,
    site?: string
  ) => Promise<readonly Pick<JiraIssue, 'key' | 'title' | 'url' | 'status'>[]>
  linearAssigned: (
    workspace?: string
  ) => Promise<readonly Pick<LinearIssue, 'identifier' | 'title' | 'url' | 'state' | 'team'>[]>
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
    originCandidate: GitHubRepositoryIdentity | null
  }
}

/** My open PRs in a repo and, for a fork, its upstream: contributions live upstream, own work on the fork. */
export async function myOpenPullRequestsOf<T extends { type: string }>(
  search: (preference: 'upstream' | 'origin') => Promise<MyOpenPrsSearch<T>>
): Promise<{ repos: GitHubRepositoryIdentity[]; items: T[] }> {
  const upstream = await search('upstream')
  const searched = upstream.sources.prs
  const origin = upstream.sources.originCandidate
  const fork = origin && searched && !sameRepo(origin, searched) ? await search('origin') : null
  const results = (fork ? [fork, upstream] : [upstream]).map((one) => ({
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

const keyPrefixOf = (identifier: string): string | undefined =>
  /^([A-Za-z][A-Za-z0-9_]*)-\d+$/.exec(identifier)?.[1]

/** The To Do when the project names none: its linked Plane project, the worktree's tracker, then its host. */
export function autoTodoSourceOf(args: {
  planeProject: string | null
  workItem: Pick<GameWorkItem, 'provider' | 'identifier'> | null
  host: 'github' | 'gitlab' | null
}): TodoSource | null {
  if (args.planeProject) {
    return { provider: 'plane', project: args.planeProject }
  }
  const item = args.workItem
  if (item?.provider === 'jira' || item?.provider === 'linear') {
    const project = keyPrefixOf(item.identifier)
    return project ? { provider: item.provider, project } : { provider: item.provider }
  }
  if (item?.provider === 'plane') {
    return { provider: 'plane' }
  }
  return args.host ? { provider: args.host } : null
}

const ciOf = async (port: GameProjectWorkPort, pr: PullRequest): Promise<CheckStatus | 'none'> => {
  const checks = await settle(() => port.githubChecks(pr))
  return checks === null ? 'none' : derivePRCheckStatus(checks)
}

async function readGitHubReviews(
  port: GameProjectWorkPort,
  repo: GitHubRepositoryIdentity
): Promise<GameProjectList> {
  const found = await port.githubPullRequests()
  const prs = found.items.filter(
    (pr, at) => found.items.findIndex((one) => one.url === pr.url) === at
  )
  // Why only the shown ones: each check read is a GraphQL call against the user's quota.
  const shown = prs.slice(0, GAME_PROJECT_ITEMS_MAX)
  const items = await Promise.all(
    shown.map(async (pr): Promise<GameProjectItem> => {
      const ci = await ciOf(port, pr)
      return {
        id: `#${pr.number}`,
        title: pr.title,
        url: pr.url,
        status: ci,
        tone: reviewToneOf(ci)
      }
    })
  )
  return gameProjectListOf(
    'github',
    items,
    reviewsListUrlOf({ provider: 'github', repo, repos: found.repos }),
    prs.length
  )
}

async function readGitLabReviews(port: GameProjectWorkPort): Promise<GameProjectList | null> {
  const mrs = await port.gitlabMergeRequests()
  if (mrs === null) {
    return null
  }
  const items = mrs.map((mr) => ({ id: `!${mr.number}`, title: mr.title, url: mr.url }))
  const url = reviewsListUrlOf({ provider: 'gitlab', sampleUrl: mrs[0]?.url ?? null })
  return gameProjectListOf('gitlab', items, url, mrs.length)
}

const DONE_PLANE_GROUPS = new Set(['completed', 'cancelled'])

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
          project: source.project,
          repo
        }),
      items.length,
      GAME_TODO_ITEMS_MAX
    )
  switch (source.provider) {
    case 'plane': {
      const open = (
        await port.planeAssigned({ project: source.project, workspace: source.workspace })
      ).filter((one) => !DONE_PLANE_GROUPS.has(one.state.group))
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
      const scope = source.project ? `project = ${source.project} AND ` : ''
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
        (one) => !source.project || one.team.key === source.project
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
        issues.map((one) => ({ id: `#${one.number}`, title: one.title, url: one.url })),
        todoListUrlOf({ provider: 'github', repo })
      )
    }
    case 'gitlab': {
      const issues = await port.gitlabIssues()
      return listOf(
        'gitlab',
        issues.map((one) => ({ id: `#${one.number}`, title: one.title, url: one.url }))
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
  const source =
    args.todo === 'off'
      ? null
      : (args.todo ??
        autoTodoSourceOf({
          planeProject: args.planeProject ?? null,
          workItem: args.workItem,
          host
        }))
  const todo = source ? await settle(() => readTodo(port, source, repo)) : null
  return { reviews, todo }
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
