import type {
  GitHubRepositoryIdentity,
  PRMergeableState
} from '../../shared/github/pull-request-types'
import type { GameProjectItem } from '../../shared/orchestrator-game-project-work'

/** Whether each PR merges cleanly, by number; `prRepo` null is the repo itself. */
export type GameMergeableRead = (
  prRepo: GitHubRepositoryIdentity | null,
  numbers: readonly number[]
) => Promise<ReadonlyMap<number, PRMergeableState>>

type PullRequestRef = { number: number; prRepo?: GitHubRepositoryIdentity | null }

export const reviewBlockOf = (
  mergeable: PRMergeableState | undefined,
  draft: boolean
): Pick<GameProjectItem, 'reviewBlock'> =>
  mergeable === 'CONFLICTING' ? { reviewBlock: 'conflict' } : draft ? { reviewBlock: 'draft' } : {}

// Why one aliased read per repo: a conflict is not in the list payload, and a read per PR would
// cost five GraphQL calls each refresh. A failed read loses the mark, never the row.
export async function readMergeableStates(
  read: GameMergeableRead,
  prs: readonly PullRequestRef[]
): Promise<ReadonlyMap<number, PRMergeableState>> {
  const byRepo = new Map<string, { repo: GitHubRepositoryIdentity | null; numbers: number[] }>()
  for (const pr of prs) {
    const key = pr.prRepo ? `${pr.prRepo.owner}/${pr.prRepo.repo}` : ''
    const group = byRepo.get(key) ?? { repo: pr.prRepo ?? null, numbers: [] }
    group.numbers.push(pr.number)
    byRepo.set(key, group)
  }
  const reads = await Promise.all(
    [...byRepo.values()].map((group) => read(group.repo, group.numbers).catch(() => null))
  )
  return new Map(reads.flatMap((one) => (one ? [...one] : [])))
}
