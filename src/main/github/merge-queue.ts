import type { GameQueueEntry } from '../../shared/orchestrator-game-project-work'
import type {
  GameQueueDeparture,
  GameQueueFailedCheck
} from '../../shared/orchestrator-game-queue-departure'
import { classifyCheckOutcome } from '../../shared/provider-check-summary'
import { latestRunsOfRollup } from '../../shared/pr-check-rollup-supersession'
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

// Why one budget note per read: each call is one GraphQL request against the repo's own budget.
async function queueGraphQL(
  repoPath: string,
  args: string[],
  connectionId: string | null | undefined,
  localGitOptions: LocalGitExecOptions
): Promise<string | null> {
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
  const owner = ['-f', `owner=${ownerRepo.owner}`, '-f', `repo=${ownerRepo.repo}`]
  const { stdout } = await ghExecFileAsync(['api', 'graphql', ...args, ...owner], {
    ...ghOptions,
    ...githubHostExecOptions(ownerRepo)
  })
  return stdout
}

/** The repo's merge queue, oldest first; null with no queue, no GitHub repo or no budget. */
export async function getMergeQueueEntries(
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GameQueueEntry[] | null> {
  const args = ['-f', `query=${MERGE_QUEUE_QUERY}`]
  const stdout = await queueGraphQL(repoPath, args, connectionId, localGitOptions)
  return stdout === null ? null : mergeQueueOfResponse(stdout)
}

const DEPARTURE_QUERY = `query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      state
      timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) {
        nodes {
          ... on RemovedFromMergeQueueEvent {
            reason
            actor { login }
            beforeCommit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      checkSuite { workflowRun { databaseId workflow { name } } }
                    }
                    ... on StatusContext { context state }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`

const DEPARTURE_STATES: Record<string, GameQueueDeparture['state']> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed'
}

type RawContext = {
  name?: unknown
  status?: unknown
  conclusion?: unknown
  checkSuite?: { workflowRun?: { databaseId?: unknown; workflow?: { name?: unknown } } } | null
  context?: unknown
  state?: unknown
} | null

type RawRemoval = {
  reason?: unknown
  actor?: { login?: unknown } | null
  beforeCommit?: {
    statusCheckRollup?: { contexts?: { nodes?: RawContext[] | null } | null } | null
  } | null
} | null

// Why the removal's commit: for failed_checks it is the merge-group commit whose checks failed.
function failedChecksOfRemoval(removal: RawRemoval): GameQueueFailedCheck[] {
  const checks = (removal?.beforeCommit?.statusCheckRollup?.contexts?.nodes ?? []).flatMap(
    (raw) => {
      const name = typeof raw?.name === 'string' ? raw.name : raw?.context
      if (typeof name !== 'string') {
        return []
      }
      const run = raw?.checkSuite?.workflowRun
      const conclusion = typeof raw?.state === 'string' ? raw.state : raw?.conclusion
      return [
        {
          name,
          workflowName: typeof run?.workflow?.name === 'string' ? run.workflow.name : undefined,
          workflowRunId: typeof run?.databaseId === 'number' ? run.databaseId : undefined,
          status: typeof raw?.status === 'string' ? raw.status : 'COMPLETED',
          conclusion: typeof conclusion === 'string' ? conclusion : null
        }
      ]
    }
  )
  return latestRunsOfRollup(checks)
    .filter((one) => classifyCheckOutcome(one) === 'failed')
    .map((one) => ({ name: one.name, runId: one.workflowRunId ?? null }))
}

/** Null when GitHub names no such PR. */
export function mergeQueueDepartureOfResponse(stdout: string): GameQueueDeparture | null {
  const parsed = JSON.parse(stdout) as {
    data?: {
      repository?: {
        pullRequest?: {
          state?: unknown
          timelineItems?: { nodes?: RawRemoval[] } | null
        } | null
      } | null
    }
  }
  const pr = parsed.data?.repository?.pullRequest
  const state = typeof pr?.state === 'string' ? DEPARTURE_STATES[pr.state] : undefined
  if (!state) {
    return null
  }
  const removal = pr?.timelineItems?.nodes?.at(-1) ?? null
  const failedChecks = failedChecksOfRemoval(removal)
  return {
    state,
    reason: typeof removal?.reason === 'string' ? removal.reason : null,
    actor: typeof removal?.actor?.login === 'string' ? removal.actor.login : null,
    ...(failedChecks.length > 0 ? { failedChecks } : {})
  }
}

/** A PR's state and its last queue removal, read fresh when the lead's watch sees it leave (ORCA-1273). */
export async function getMergeQueueDeparture(
  repoPath: string,
  number: number,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GameQueueDeparture | null> {
  const args = ['-f', `query=${DEPARTURE_QUERY}`, '-F', `pr=${number}`]
  const stdout = await queueGraphQL(repoPath, args, connectionId, localGitOptions)
  return stdout === null ? null : mergeQueueDepartureOfResponse(stdout)
}
