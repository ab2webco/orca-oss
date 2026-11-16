import type { CheckStatus } from '../../../../shared/github/pull-request-types'
import type { HostedReviewState } from '../../../../shared/hosted-review'
import type { GameHistoryRecord } from '../../../../shared/orchestrator-game-history'
import { ticketInText } from '../../../../shared/orchestrator-game-ticket-id'

/**
 * Owner decision (ORCA-1216 §6): a delivered row folds 24 h after its member was freed.
 * Why its own constant: PROJECT_ACTIVITY_WINDOW_MS is the default of a user setting, this is fixed.
 */
export const DELIVERED_FOLD_AFTER_MS = 24 * 60 * 60 * 1000

/** A freed member's worktree still under its lead, as the lead's history names it. */
export type DeliveredMember = {
  worktreeId: string
  ticket: string | null
  branch: string | null
  character: string | null
  /** When the lead freed it: the history record's `endedAt`, ms. */
  freedAt: number
  /** The PR as the lead recorded it on freeing; the card's own review read supersedes it. */
  recordedPr: { number: number; state: HostedReviewState } | null
}

export type DeliveredPr = {
  number: number
  title: string | null
  state: HostedReviewState
  /** Null when only the recorded PR is known. */
  ci: CheckStatus | null
  /** The lead's merge queue lists it. */
  queued: boolean
}

export type DeliveredPrKind = 'merged' | 'open' | 'ciFailing' | 'closed' | 'none'

const REVIEW_STATES: readonly HostedReviewState[] = ['open', 'closed', 'merged', 'draft']

function recordedPrOf(text: string | null): DeliveredMember['recordedPr'] {
  const match = text?.match(/^#(\d+) (\w+)$/)
  const state = REVIEW_STATES.find((one) => one === match?.[2])
  return match && state ? { number: Number(match[1]), state } : null
}

const shortBranch = (branch: string | null | undefined): string | null =>
  branch ? branch.replace(/^refs\/heads\//, '') : null

export function deliveredMembersOf(args: {
  records: readonly GameHistoryRecord[]
  leadWorktreeId: string
  liveWorktreeIds: ReadonlySet<string>
  worktrees: readonly { id: string; branch: string | null; parentWorktreeId: string | null }[]
}): Record<string, DeliveredMember> {
  const delivered: Record<string, DeliveredMember> = {}
  for (const worktree of args.worktrees) {
    if (worktree.id === args.leadWorktreeId || args.liveWorktreeIds.has(worktree.id)) {
      continue
    }
    const branch = shortBranch(worktree.branch)
    let latest: GameHistoryRecord | null = null
    for (const one of args.records) {
      // Why the branch: an older host's records name no worktree, only the branch it worked on.
      const mine = one.worktreeId
        ? one.worktreeId === worktree.id
        : branch !== null && shortBranch(one.branch) === branch
      // Why the lineage for an older record: it names no lead, and only nesting ties it to this one.
      const lead = one.leadWorktreeId ?? (one.worktreeId ? null : worktree.parentWorktreeId)
      if (mine && lead === args.leadWorktreeId && (!latest || latest.endedAt <= one.endedAt)) {
        latest = one
      }
    }
    if (latest) {
      delivered[worktree.id] = {
        worktreeId: worktree.id,
        ticket: latest.ticket ?? ticketInText(latest.branch) ?? ticketInText(branch),
        branch: shortBranch(latest.branch) ?? branch,
        character: latest.character ?? null,
        freedAt: Date.parse(latest.endedAt),
        recordedPr: recordedPrOf(latest.pr)
      }
    }
  }
  return delivered
}

/** The card's review read, when it names a state; else the PR recorded at the free. */
export function deliveredPrOf(
  review:
    | { number: number; title?: string; state?: HostedReviewState; status?: CheckStatus }
    | null
    | undefined,
  recorded: DeliveredMember['recordedPr'],
  queuedNumbers: ReadonlySet<number>
): DeliveredPr | null {
  if (review?.state) {
    return {
      number: review.number,
      title: review.title ?? null,
      state: review.state,
      ci: review.status ?? null,
      queued: queuedNumbers.has(review.number)
    }
  }
  // Why no title: a linked review not read yet carries a placeholder title, not the PR's.
  const known = recorded ?? null
  return known
    ? {
        number: known.number,
        title: null,
        state: known.state,
        ci: null,
        queued: queuedNumbers.has(known.number)
      }
    : null
}

export function deliveredPrKindOf(pr: DeliveredPr | null): DeliveredPrKind {
  if (!pr) {
    return 'none'
  }
  if (pr.state === 'merged' || pr.state === 'closed') {
    return pr.state
  }
  return pr.ci === 'failure' ? 'ciFailing' : 'open'
}

/** Newest delivery first; past the fold every row folds except a CI failure. */
export function groupDeliveredRows<T extends Pick<DeliveredMember, 'worktreeId' | 'freedAt'>>(
  rows: readonly T[],
  kindOf: (worktreeId: string) => DeliveredPrKind,
  now: number
): { recent: T[]; folded: T[] } {
  const sorted = [...rows].sort((a, b) => b.freedAt - a.freedAt)
  const folds = (row: T): boolean =>
    now - row.freedAt > DELIVERED_FOLD_AFTER_MS && kindOf(row.worktreeId) !== 'ciFailing'
  return { recent: sorted.filter((row) => !folds(row)), folded: sorted.filter(folds) }
}

export type AlsoWorkedOn = { ticket: string; kind: 'merged' | 'open' | 'freed' | 'inProgress' }

/** The character's other tickets for the hover card: its history newest first, then live ones. */
export function alsoWorkedOn(args: {
  character: string | null
  ticket: string | null
  records: readonly GameHistoryRecord[]
  liveMembers: readonly { name: string; ticket: string | null }[]
}): AlsoWorkedOn[] {
  const name = args.character?.trim().toLowerCase()
  if (!name) {
    return []
  }
  const seen = new Set(args.ticket ? [args.ticket] : [])
  const out: AlsoWorkedOn[] = []
  const add = (ticket: string | null, kind: AlsoWorkedOn['kind']): void => {
    if (ticket && !seen.has(ticket)) {
      seen.add(ticket)
      out.push({ ticket, kind })
    }
  }
  const live = args.liveMembers.filter((one) => one.name.trim().toLowerCase() === name)
  for (const one of live) {
    seen.add(one.ticket ?? '')
  }
  const newestFirst = args.records
    .toReversed()
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))
  for (const one of newestFirst) {
    if (one.character?.trim().toLowerCase() === name) {
      const state = recordedPrOf(one.pr)?.state
      add(
        one.ticket,
        state === 'merged' ? 'merged' : state === 'open' || state === 'draft' ? 'open' : 'freed'
      )
    }
  }
  for (const one of live) {
    seen.delete(one.ticket ?? '')
    add(one.ticket, 'inProgress')
  }
  return out
}
