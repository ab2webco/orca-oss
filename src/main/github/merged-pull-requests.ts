import type { IssueSourcePreference } from '../../shared/repo-types'
import {
  GAME_DELIVERY_PAGE_SIZE,
  gameDeliveryOf,
  gameMergedReviewsOfGitHubSearch,
  type GameDelivery
} from '../../shared/orchestrator-game-delivery'
import {
  acquire,
  ghExecFileAsync,
  ghRepoExecOptions,
  githubRepoContext,
  release,
  type LocalGitExecOptions
} from './gh-utils'
import {
  getGitHubApiRepositoryForRemote,
  getOriginGitHubApiRepository,
  githubHostExecOptions
} from './github-api-repository'
import { noteRepositoryRateLimitSpend, repositoryRateLimitGuard } from './rate-limit'

// Why second-precision: GitHub's search date qualifier takes no milliseconds.
const searchDateOf = (iso: string): string => iso.replace(/\.\d{3}Z$/, 'Z')

/** The repo's PRs merged since `since`, from GitHub search; null when it is not on GitHub. */
export async function listMergedPullRequestsSince(args: {
  repoPath: string
  since: string
  now: number
  preference?: IssueSourcePreference
  connectionId?: string | null
  localGitOptions?: LocalGitExecOptions
}): Promise<GameDelivery | null> {
  const { repoPath, connectionId, localGitOptions = {} } = args
  const [origin, upstream] = await Promise.all([
    getOriginGitHubApiRepository(repoPath, connectionId, localGitOptions),
    getGitHubApiRepositoryForRemote(repoPath, 'upstream', connectionId, localGitOptions)
  ])
  // Why upstream first: Orca lists a fork's PRs from where they merge, unless pinned to origin.
  const ownerRepo = args.preference === 'origin' ? origin : (upstream ?? origin)
  if (!ownerRepo) {
    return null
  }
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  const repo = `${ownerRepo.owner}/${ownerRepo.repo}`
  const q = encodeURIComponent(`repo:${repo} is:pr is:merged merged:>=${searchDateOf(args.since)}`)
  return gameDeliveryOf({
    provider: 'github',
    repo,
    since: args.since,
    now: args.now,
    readPage: async (page) => {
      // Why throw: the caller's cache then answers the game's own numbers until the next refresh.
      if (repositoryRateLimitGuard(ownerRepo, 'search', ghOptions).blocked) {
        throw new Error('GitHub search budget is exhausted')
      }
      await acquire()
      try {
        const { stdout } = await ghExecFileAsync(
          [
            'api',
            `search/issues?q=${q}&sort=created&order=desc&per_page=${GAME_DELIVERY_PAGE_SIZE}&page=${page}`
          ],
          ghOptions
        )
        noteRepositoryRateLimitSpend(ownerRepo, 'search', 1, ghOptions)
        const body = JSON.parse(stdout) as { total_count?: unknown; items?: unknown }
        return {
          reviews: gameMergedReviewsOfGitHubSearch(Array.isArray(body.items) ? body.items : []),
          total: typeof body.total_count === 'number' ? body.total_count : null
        }
      } finally {
        release()
      }
    }
  })
}
