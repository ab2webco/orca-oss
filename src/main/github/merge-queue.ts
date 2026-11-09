import type { GameQueueEntry } from '../../shared/orchestrator-game-project-work'
import { ghExecFileAsync, type LocalGitExecOptions } from './gh-utils'
import { githubHostExecOptions, resolveGitHubRepoExecution } from './github-api-repository'
import { noteRepositoryRateLimitSpend, repositoryRateLimitGuard } from './rate-limit'

const ENTRIES_MAX = 20

// Why no separate "is a queue required" read: `mergeQueue` is null without one, so this query
// costs what that check alone would. No `branch` argument reads the default branch.
const MERGE_QUEUE_QUERY = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    mergeQueue {
      entries(first: ${ENTRIES_MAX}) {
        nodes { position state enqueuedAt pullRequest { number title url } }
      }
    }
  }
}`

type RawEntry = {
  position?: unknown
  state?: unknown
  enqueuedAt?: unknown
  pullRequest?: { number?: unknown; title?: unknown; url?: unknown } | null
} | null

function stateOf(state: unknown): GameQueueEntry['state'] {
  switch (state) {
    case 'AWAITING_CHECKS':
    case 'LOCKED':
    case 'MERGEABLE':
      return 'checks'
    case 'UNMERGEABLE':
      return 'failed'
    default:
      return 'waiting'
  }
}

function entryOf(raw: RawEntry): GameQueueEntry | null {
  const pr = raw?.pullRequest
  if (typeof pr?.number !== 'number' || typeof pr.url !== 'string') {
    return null
  }
  const since = typeof raw?.enqueuedAt === 'string' ? Date.parse(raw.enqueuedAt) : Number.NaN
  return {
    id: `#${pr.number}`,
    title: typeof pr.title === 'string' ? pr.title : '',
    url: pr.url,
    position: typeof raw?.position === 'number' ? raw.position : 0,
    state: stateOf(raw?.state),
    since: Number.isNaN(since) ? null : since
  }
}

/** Null when the branch has no merge queue; empty when it has one and nothing waits. */
export function mergeQueueOfResponse(stdout: string): GameQueueEntry[] | null {
  const parsed = JSON.parse(stdout) as {
    data?: {
      repository?: { mergeQueue?: { entries?: { nodes?: RawEntry[] | null } | null } | null } | null
    }
  }
  const queue = parsed.data?.repository?.mergeQueue
  if (!queue) {
    return null
  }
  return (queue.entries?.nodes ?? [])
    .flatMap((raw) => entryOf(raw) ?? [])
    .sort((a, b) => a.position - b.position)
}

/** The repo's merge queue, oldest first; null with no queue, no GitHub repo or no budget. */
export async function getMergeQueueEntries(
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GameQueueEntry[] | null> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    null,
    connectionId,
    localGitOptions
  )
  if (!ownerRepo || repositoryRateLimitGuard(ownerRepo, 'graphql', ghOptions).blocked) {
    return null
  }
  noteRepositoryRateLimitSpend(ownerRepo, 'graphql', 1, ghOptions)
  const { stdout } = await ghExecFileAsync(
    [
      'api',
      'graphql',
      '-f',
      `query=${MERGE_QUEUE_QUERY}`,
      '-f',
      `owner=${ownerRepo.owner}`,
      '-f',
      `repo=${ownerRepo.repo}`
    ],
    { ...ghOptions, ...githubHostExecOptions(ownerRepo) }
  )
  return mergeQueueOfResponse(stdout)
}
