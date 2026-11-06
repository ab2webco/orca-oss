import type { PRCheckDetail } from '../../shared/github/check-types'
import type { CheckStatus, GitHubRepositoryIdentity } from '../../shared/github/pull-request-types'
import type { GitHubWorkItem } from '../../shared/github/work-item-types'
import type { GitLabWorkItem } from '../../shared/gitlab-types'
import { derivePRCheckStatus } from '../../shared/pr-check-status'
import {
  GAME_PROJECT_ITEMS_MAX,
  gameProjectListOf,
  reviewsListUrlOf,
  reviewToneOf,
  type GameProjectItem,
  type GameProjectList
} from '../../shared/orchestrator-game-project-work'
import {
  readMergeableStates,
  reviewBlockOf,
  type GameMergeableRead
} from './orchestrator-game-review-blocks'

type PullRequest = Pick<GitHubWorkItem, 'number' | 'title' | 'url' | 'headSha' | 'prRepo'> &
  Partial<Pick<GitHubWorkItem, 'state'>>

/** The provider calls the project's PR list needs; each one may throw. */
export type GameProjectReviewsPort = {
  /** My open PRs and the repos holding them, out of a fork and its upstream when it has one. */
  githubPullRequests: () => Promise<{
    repos: readonly GitHubRepositoryIdentity[]
    items: readonly PullRequest[]
  }>
  githubChecks: (pr: PullRequest) => Promise<readonly PRCheckDetail[]>
  githubMergeable: GameMergeableRead
  /** Null when the repo is not a GitLab project. */
  gitlabMergeRequests: () => Promise<
    | readonly (Pick<GitLabWorkItem, 'number' | 'title' | 'url' | 'state'> &
        Partial<Pick<GitLabWorkItem, 'mergeable'>>)[]
    | null
  >
}

const ciOf = async (
  port: GameProjectReviewsPort,
  pr: PullRequest
): Promise<CheckStatus | 'none'> => {
  const checks = await port.githubChecks(pr).catch(() => null)
  return checks === null ? 'none' : derivePRCheckStatus(checks)
}

export async function readGitHubReviews(
  port: GameProjectReviewsPort,
  repo: GitHubRepositoryIdentity
): Promise<GameProjectList> {
  const found = await port.githubPullRequests()
  const prs = found.items.filter(
    (pr, at) => found.items.findIndex((one) => one.url === pr.url) === at
  )
  // Why only the shown ones: each check read is a GraphQL call against the user's quota.
  const shown = prs.slice(0, GAME_PROJECT_ITEMS_MAX)
  const mergeable = await readMergeableStates(port.githubMergeable, shown)
  const items = await Promise.all(
    shown.map(async (pr): Promise<GameProjectItem> => {
      const ci = await ciOf(port, pr)
      return {
        id: `#${pr.number}`,
        title: pr.title,
        url: pr.url,
        status: ci,
        tone: reviewToneOf(ci),
        ...reviewBlockOf(mergeable.get(pr.number), pr.state === 'draft')
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

export async function readGitLabReviews(
  port: GameProjectReviewsPort
): Promise<GameProjectList | null> {
  const mrs = await port.gitlabMergeRequests()
  if (mrs === null) {
    return null
  }
  const items = mrs.map((mr) => ({
    id: `!${mr.number}`,
    title: mr.title,
    url: mr.url,
    ...reviewBlockOf(mr.mergeable, mr.state === 'draft')
  }))
  const url = reviewsListUrlOf({ provider: 'gitlab', sampleUrl: mrs[0]?.url ?? null })
  return gameProjectListOf('gitlab', items, url, mrs.length)
}
