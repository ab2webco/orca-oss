import type { CheckStatus } from '../../shared/github/pull-request-types'
import { githubRepoIdentityKey } from '../../shared/github/repository-identity-key'
import { ghExecFileAsync } from '../git/runner'
import {
  githubHostExecOptions,
  type GitHubApiRepository,
  type GitHubRepoExecOptions
} from './github-api-repository'
import { noteRepositoryRateLimitSpend, repositoryRateLimitGuard } from './rate-limit'

export type PullRequestHeadCi = { headSha: string; ci: CheckStatus }

export type PullRequestReviewFacts = {
  ciHistory: PullRequestHeadCi[]
  commentCount: number
  reopenCount: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const countOf = (value: unknown, key: string): number | null => {
  const count = isRecord(value) ? value[key] : undefined
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null
}

const nodesOf = (value: unknown): unknown[] =>
  isRecord(value) && Array.isArray(value.nodes) ? value.nodes : []

const CI_OF_ROLLUP: Record<string, CheckStatus> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  PENDING: 'pending',
  EXPECTED: 'pending'
}

// Why: a commit with no rollup was never a pushed head CI ran on.
const headCiOf = (commit: unknown): PullRequestHeadCi | null => {
  if (!isRecord(commit) || typeof commit.oid !== 'string' || !isRecord(commit.statusCheckRollup)) {
    return null
  }
  const state = commit.statusCheckRollup.state
  return {
    headSha: commit.oid,
    ci: (typeof state === 'string' && CI_OF_ROLLUP[state]) || 'neutral'
  }
}

export function reviewFactsOf(response: unknown): PullRequestReviewFacts | null {
  const data = isRecord(response) ? response.data : undefined
  const repository = isRecord(data) ? data.repository : undefined
  const pr = isRecord(repository) ? repository.pullRequest : undefined
  if (!isRecord(pr)) {
    return null
  }
  const commentCount = countOf(pr.reviewThreads, 'totalCount')
  // Why: totalCount ignores itemTypes and counts the whole timeline.
  const reopenCount = countOf(pr.reopened, 'filteredCount')
  if (commentCount === null || reopenCount === null) {
    return null
  }
  // Why: a rebase drops old heads from `commits`; force-push events keep their CI.
  const heads = [
    ...nodesOf(pr.forcePushes).map((node) => (isRecord(node) ? node.beforeCommit : null)),
    ...nodesOf(pr.commits).map((node) => (isRecord(node) ? node.commit : null))
  ]
  const ciHistory: PullRequestHeadCi[] = []
  for (const one of heads.map(headCiOf)) {
    if (one && !ciHistory.some((seen) => seen.headSha === one.headSha)) {
      ciHistory.push(one)
    }
  }
  return { ciHistory, commentCount, reopenCount }
}

const REVIEW_FACTS_QUERY = `query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads { totalCount }
      reopened: timelineItems(first: 1, itemTypes: [REOPENED_EVENT]) { filteredCount }
      forcePushes: timelineItems(last: 50, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) {
        nodes { ... on HeadRefForcePushedEvent { beforeCommit { oid statusCheckRollup { state } } } }
      }
      commits(last: 100) { nodes { commit { oid statusCheckRollup { state } } } }
    }
  }
}`

async function fetchReviewFacts(
  repository: GitHubApiRepository,
  number: number,
  ghOptions: GitHubRepoExecOptions
): Promise<PullRequestReviewFacts | null> {
  if (repositoryRateLimitGuard(repository, 'graphql', ghOptions).blocked) {
    return null
  }
  noteRepositoryRateLimitSpend(repository, 'graphql', 1, ghOptions)
  try {
    const { stdout } = await ghExecFileAsync(
      [
        'api',
        'graphql',
        '-f',
        `query=${REVIEW_FACTS_QUERY}`,
        '-f',
        `owner=${repository.owner}`,
        '-f',
        `repo=${repository.repo}`,
        '-F',
        `pr=${number}`
      ],
      { ...ghOptions, ...githubHostExecOptions(repository) }
    )
    return reviewFactsOf(JSON.parse(stdout))
  } catch {
    return null
  }
}

const FAILED_READ_RETRY_MS = 60_000
const CACHE_MAX_ENTRIES = 256

type CachedFacts = { version: string; value: PullRequestReviewFacts | null; retryAt: number }

const cache = new Map<string, CachedFacts>()
const inFlight = new Map<string, Promise<PullRequestReviewFacts | null>>()

type ReviewFactsDeps = { readFacts?: typeof fetchReviewFacts; now?: () => number }

/** One GraphQL read per pull request version (`updatedAt`, head and CI status); null when unreadable. */
export async function getGitHubPullRequestReviewFacts(
  args: {
    repository: GitHubApiRepository
    number: number
    version: string
    ghOptions: GitHubRepoExecOptions
    executionScope?: string
  },
  { readFacts = fetchReviewFacts, now = Date.now }: ReviewFactsDeps = {}
): Promise<PullRequestReviewFacts | null> {
  const key = `${args.executionScope ?? 'default'}\0${githubRepoIdentityKey(args.repository)}#${args.number}`
  const cached = cache.get(key)
  if (cached?.version === args.version && (cached.value !== null || now() < cached.retryAt)) {
    return cached.value
  }
  const flightKey = `${key}@${args.version}`
  const existing = inFlight.get(flightKey)
  if (existing) {
    return existing
  }
  const request = readFacts(args.repository, args.number, args.ghOptions)
  inFlight.set(flightKey, request)
  try {
    const value = await request
    cache.delete(key)
    cache.set(key, { version: args.version, value, retryAt: now() + FAILED_READ_RETRY_MS })
    if (cache.size > CACHE_MAX_ENTRIES) {
      cache.delete(cache.keys().next().value ?? key)
    }
    return value
  } finally {
    inFlight.delete(flightKey)
  }
}
