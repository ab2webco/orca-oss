import type { CommandHandler } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import type { RuntimeWorktreeListResult, RuntimeWorktreeRecord } from '../../shared/runtime-types'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import type { HostedReviewInfo } from '../../shared/hosted-review'

type Client = Parameters<CommandHandler>[0]['client']

const LIST_LIMIT = 1000

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const basenameOf = (path: string): string => path.split(/[\\/]/).findLast(Boolean) ?? ''

const branchNameOf = (branch: string | null | undefined): string =>
  (branch ?? '').replace(/^refs\/heads\//, '')

function linkedTicketsOf(worktree: RuntimeWorktreeRecord): string[] {
  const item = worktree.linkedWorkItem
  return [
    worktree.linkedPlaneWorkItem?.identifier,
    worktree.linkedLinearIssue,
    item?.planeIdentifier,
    item?.linearIdentifier,
    item?.jiraIdentifier
  ].flatMap((id) => (id ? [id.toUpperCase()] : []))
}

/** 3 the previous member's, 2 linked to the ticket, 1 named after it, 0 not its worktree. */
function ticketRankOf(
  worktree: RuntimeWorktreeRecord,
  ticket: string,
  previous: ReadonlySet<string>
): number {
  if (previous.has(worktree.id)) {
    return 3
  }
  const linked = linkedTicketsOf(worktree)
  if (linked.includes(ticket)) {
    return 2
  }
  // Why: a worktree linked to another ticket is that ticket's, whatever its name says.
  if (linked.length > 0) {
    return 0
  }
  // Why the boundaries: CIN-12 must not match cin-123 or xcin-12; Orca's dedupe suffix cin-12-2 does.
  const named = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(ticket.toLowerCase())}(?![a-z0-9])`)
  const names = [basenameOf(worktree.path), branchNameOf(worktree.branch ?? worktree.git?.branch)]
  return names.some((name) => named.test(name.toLowerCase())) ? 1 : 0
}

// Why the host's read: a member's `gh pr create` never writes meta.linkedPR, so the branch decides.
async function holdsOpenReview(client: Client, worktree: RuntimeWorktreeRecord): Promise<boolean> {
  const branch = branchNameOf(worktree.branch ?? worktree.git?.branch)
  if (!branch) {
    return false
  }
  const review = await client
    .call<HostedReviewInfo | null>('hostedReview.forBranch', {
      repo: `id:${worktree.repoId}`,
      branch,
      linkedGitHubPR: worktree.linkedPR ?? null,
      linkedGitLabMR: worktree.linkedGitLabMR ?? null,
      linkedBitbucketPR: worktree.linkedBitbucketPR ?? null,
      linkedAzureDevOpsPR: worktree.linkedAzureDevOpsPR ?? null,
      linkedGiteaPR: worktree.linkedGiteaPR ?? null
    })
    .then(
      (response) => response.result,
      () => null
    )
  return review?.state === 'open' || review?.state === 'draft'
}

/**
 * The selector of the ticket's existing worktree to relaunch in, or null for a new one.
 * Read-only: lists worktrees and reviews and reads game state, never checks out or writes a link.
 */
async function existingTicketWorktreeOf(args: {
  client: Client
  state: OrchestratorGameState
  ticket: string
  repo: string | null
}): Promise<string | null> {
  const { client, state, ticket } = args
  const lead = state.worktree?.id ?? null
  // Why: new-child branches from the lead's repo, so that is where the ticket's worktree lives.
  const repo = args.repo ?? (lead ? `id:${getRepoIdFromWorktreeId(lead)}` : null)
  if (repo === null) {
    return null
  }
  const listed = await client.call<RuntimeWorktreeListResult>('worktree.list', {
    repo,
    limit: LIST_LIMIT
  })
  const previous = new Set(
    (state.unlistedMembers ?? []).flatMap((one) => (one.ticket === ticket ? [one.worktreeId] : []))
  )
  const ranked = listed.result.worktrees
    .filter((one) => one.id !== lead && !one.isArchived && !one.git?.isMainWorktree)
    .map((one) => ({ worktree: one, rank: ticketRankOf(one, ticket, previous) }))
    .filter((one) => one.rank > 0)
  for (const { worktree } of ranked) {
    // Why any row: a `done` agent sits at its prompt; an exited one's row is retired.
    const live = state.agents.find((agent) => agent.worktree?.id === worktree.id)
    if (live) {
      throw new RuntimeClientError(
        'invalid_argument',
        `${ticket} already has a live agent in ${worktree.path} (${live.displayName ?? live.paneKey}); stop it before launching again.`
      )
    }
  }
  const top = Math.max(0, ...ranked.map((one) => one.rank))
  let best = ranked.filter((one) => one.rank === top).map((one) => one.worktree)
  if (best.length > 1) {
    const open = await Promise.all(best.map((one) => holdsOpenReview(client, one)))
    const withReview = best.filter((_, index) => open[index])
    best = withReview.length > 0 ? withReview : best
  }
  if (best.length > 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${ticket} matches ${best.length} worktrees (${best.map((one) => one.path).join(', ')}); remove or link the stale one before launching again.`
    )
  }
  const [only] = best
  return only ? `id:${only.id}` : null
}

/**
 * Where workerStart puts the member. Runs before anything else in a launch, so a refusal
 * leaves no reserved name, task or member record behind (ORCA-675).
 */
export async function memberWorktreeParamsOf(args: {
  client: Client
  state: OrchestratorGameState
  ticket: string
  repo: string | null
}): Promise<{ worktree: string; repo?: string }> {
  const reuse = await existingTicketWorktreeOf(args)
  if (reuse) {
    return { worktree: reuse }
  }
  // Why: a project whose tickets live in other repos (cineco FE/BE) names one; new-child stays in the lead's.
  return args.repo ? { worktree: 'new-top-level', repo: args.repo } : { worktree: 'new-child' }
}
