import { useEffect, useMemo } from 'react'
import type { CheckStatus } from '../../../../shared/github/pull-request-types'
import type { HostedReviewState } from '../../../../shared/hosted-review'
import {
  deliveredPrKindOf,
  deliveredPrOf,
  type DeliveredMember,
  type DeliveredPr,
  type DeliveredPrKind
} from './sidebar-delivered-members'
import { noteDeliveredPrKind, useSidebarDeliveredStore } from './sidebar-delivered-store'

export type DeliveredView = {
  member: DeliveredMember
  pr: DeliveredPr | null
  kind: DeliveredPrKind
}

type CardReview = {
  number: number
  title?: string
  state?: HostedReviewState
  status?: CheckStatus
} | null

/** A delivered card's PR from its own review read; publishes the state its lead's group folds by. */
export function useSidebarDeliveredView(
  worktreeId: string,
  member: DeliveredMember | null,
  review: CardReview | undefined
): DeliveredView | null {
  const queued = useSidebarDeliveredStore((s) => s.queuedPrNumbers)
  const number = review?.number
  const title = review?.title
  const state = review?.state
  const status = review?.status
  const view = useMemo<DeliveredView | null>(() => {
    if (!member) {
      return null
    }
    const read = number === undefined ? null : { number, title, state, status }
    const pr = deliveredPrOf(read, member.recordedPr, queued)
    return { member, pr, kind: deliveredPrKindOf(pr) }
  }, [member, number, title, state, status, queued])
  const kind = view?.kind ?? null
  useEffect(() => noteDeliveredPrKind(worktreeId, kind), [worktreeId, kind])
  useEffect(() => () => noteDeliveredPrKind(worktreeId, null), [worktreeId])
  return view
}
