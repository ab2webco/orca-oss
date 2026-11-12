import type { TeamMemberCard, TeamQueueEntry } from '../team-panel-model-types'

/** What a working member's monitor shows; absent leaves the plain code screen. */
export type TeamSceneDesk =
  | { kind: 'plan' }
  | { kind: 'tests' }
  | { kind: 'checks' }
  | { kind: 'review'; verdict: 'approved' | 'changes' | 'waiting' }
  | { kind: 'queue'; position: number }

const VERDICT = {
  approved: 'approved',
  changes_requested: 'changes',
  review_required: 'waiting'
} as const

/**
 * The card's own facts as a desk, furthest along first: its merge-queue place, checks running
 * on its open PR, its review, then its phase. A missing reading draws nothing, never a pass.
 */
export function teamSceneDeskOf(
  card: Pick<TeamMemberCard, 'paneKey' | 'flowPhase' | 'pr'>,
  queue: readonly TeamQueueEntry[] | null
): TeamSceneDesk | undefined {
  // Why not failed: a failed entry is red CI, which the site and its virus already draw.
  const entry = queue?.find((one) => one.memberKey === card.paneKey && one.state !== 'failed')
  if (entry) {
    return { kind: 'queue', position: entry.position }
  }
  const open = card.pr?.state === 'open' || card.pr?.state === 'draft' ? card.pr : null
  if (open?.ci === 'pending') {
    return { kind: 'checks' }
  }
  if (open?.verdict) {
    return { kind: 'review', verdict: VERDICT[open.verdict] }
  }
  if (card.flowPhase === 'plan' || card.flowPhase === 'docs') {
    return { kind: 'plan' }
  }
  return card.flowPhase === 'tests' ? { kind: 'tests' } : undefined
}
