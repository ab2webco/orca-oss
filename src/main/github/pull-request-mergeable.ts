import type { PRMergeableState } from '../../shared/github/pull-request-types'
import { ghExecFileAsync, type LocalGitExecOptions } from './gh-utils'
import {
  githubHostExecOptions,
  resolveGitHubRepoExecution,
  type GitHubApiRepository
} from './github-api-repository'
import { noteRepositoryRateLimitSpend, repositoryRateLimitGuard } from './rate-limit'

const MERGEABLE_STATES: readonly PRMergeableState[] = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN']

const aliasOf = (number: number): string => `pr${number}`

/** One aliased query, so reading a page of PRs costs one GraphQL call. */
export function mergeableQueryOf(numbers: readonly number[]): string {
  const fields = numbers.map((number) => {
    // Why: the numbers are written into the query, so anything else must never reach it.
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error(`Not a pull request number: ${number}`)
    }
    return `${aliasOf(number)}: pullRequest(number: ${number}) { mergeable }`
  })
  return `query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) { ${fields.join(' ')} }
  }`
}

export function mergeableOfResponse(
  stdout: string,
  numbers: readonly number[]
): Map<number, PRMergeableState> {
  const parsed = JSON.parse(stdout) as {
    data?: { repository?: Record<string, { mergeable?: unknown } | null> | null }
  }
  const repository = parsed.data?.repository
  const states = new Map<number, PRMergeableState>()
  for (const number of numbers) {
    const value = repository?.[aliasOf(number)]?.mergeable
    const known = MERGEABLE_STATES.find((one) => one === value)
    if (known) {
      states.set(number, known)
    }
  }
  return states
}

/** Whether each PR merges cleanly; empty when the repo is unknown or its budget is spent. */
export async function getPullRequestsMergeable(
  repoPath: string,
  prRepo: GitHubApiRepository | null,
  numbers: readonly number[],
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<Map<number, PRMergeableState>> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    prRepo,
    connectionId,
    localGitOptions
  )
  if (!ownerRepo || numbers.length === 0) {
    return new Map()
  }
  if (repositoryRateLimitGuard(ownerRepo, 'graphql', ghOptions).blocked) {
    return new Map()
  }
  noteRepositoryRateLimitSpend(ownerRepo, 'graphql', 1, ghOptions)
  const { stdout } = await ghExecFileAsync(
    [
      'api',
      'graphql',
      '-f',
      `query=${mergeableQueryOf(numbers)}`,
      '-f',
      `owner=${ownerRepo.owner}`,
      '-f',
      `repo=${ownerRepo.repo}`
    ],
    { ...ghOptions, ...githubHostExecOptions(ownerRepo) }
  )
  return mergeableOfResponse(stdout, numbers)
}
