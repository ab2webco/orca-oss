import type { HostedReviewInfo } from '../../shared/hosted-review'
import { ghRepoExecOptions } from '../github/github-repository-identity'
import {
  getGitHubPullRequestReviewFacts,
  type PullRequestReviewFacts
} from '../github/pull-request-review-facts'

/** The game's review with the facts the perfect-merge rule reads; only GitHub has them. */
export async function withGameReviewFacts(
  review: HostedReviewInfo | null,
  repo: { path: string; connectionId?: string | null },
  read: (
    args: Parameters<typeof getGitHubPullRequestReviewFacts>[0]
  ) => Promise<PullRequestReviewFacts | null> = getGitHubPullRequestReviewFacts
): Promise<(HostedReviewInfo & Partial<PullRequestReviewFacts>) | null> {
  const repository = review?.provider === 'github' ? review.githubRepository : undefined
  if (!review || !repository) {
    return review
  }
  const facts = await read({
    repository,
    number: review.number,
    // Why: a push, comment or reopen bumps updatedAt; a head's CI finishing changes only status.
    version: `${review.updatedAt}|${review.headSha ?? ''}|${review.status}`,
    ghOptions: ghRepoExecOptions({ repoPath: repo.path, connectionId: repo.connectionId }),
    executionScope: repo.connectionId ? `ssh:${repo.connectionId}` : 'local'
  })
  return facts ? { ...review, ...facts } : review
}
