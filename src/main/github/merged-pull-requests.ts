import {
  GAME_DELIVERY_PAGE_SIZE,
  gameDeliveryOf,
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
import { getOriginGitHubApiRepository, githubHostExecOptions } from './github-api-repository'
import { noteRepositoryRateLimitSpend, repositoryRateLimitGuard } from './rate-limit'

/** The repo's PRs merged since `since`, from GitHub search; null when it is not on GitHub. */
export async function listMergedPullRequestsSince(args: {
  repoPath: string
  since: string
  now: number
  connectionId?: string | null
  localGitOptions?: LocalGitExecOptions
}): Promise<GameDelivery | null> {
  const { repoPath, connectionId, localGitOptions = {} } = args
  // Why origin only: the Panel's My PRs links the repo `getRepoSlug` resolves, never a fork's upstream.
  const ownerRepo = await getOriginGitHubApiRepository(repoPath, connectionId, localGitOptions)
  if (!ownerRepo) {
    return null
  }
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  const repo = `${ownerRepo.owner}/${ownerRepo.repo}`
  // Why second-precision: GitHub's search date qualifier takes no milliseconds.
  const since = args.since.replace(/\.\d{3}Z$/, 'Z')
  const q = encodeURIComponent(`repo:${repo} is:pr is:merged merged:>=${since}`)
  const base = { provider: 'github' as const, repo, since: args.since, now: args.now }
  return gameDeliveryOf(base, async (page) => {
    // Why throw: the caller's cache then answers the game's own numbers until the next refresh.
    if (repositoryRateLimitGuard(ownerRepo, 'search', ghOptions).blocked) {
      throw new Error('GitHub search budget is exhausted')
    }
    await acquire()
    try {
      const path = `search/issues?q=${q}&sort=created&order=desc&per_page=${GAME_DELIVERY_PAGE_SIZE}&page=${page}`
      const { stdout } = await ghExecFileAsync(['api', path], ghOptions)
      noteRepositoryRateLimitSpend(ownerRepo, 'search', 1, ghOptions)
      const body = JSON.parse(stdout) as { total_count?: unknown; items?: unknown }
      const total = typeof body.total_count === 'number' ? body.total_count : null
      return { items: Array.isArray(body.items) ? body.items : [], total }
    } finally {
      release()
    }
  })
}
