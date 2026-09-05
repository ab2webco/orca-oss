import { useCallback, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { addPlaneWorkItemComment } from './plane-work-item-comment'
import type { PlaneBoardEditTarget } from './use-plane-board-edits'

export const PLANE_COMMENT_UNANSWERED_MESSAGE =
  'The host did not answer in time. Check the card in Plane before posting again.'

export type PlaneBoardCommentFailure = {
  /** The text Plane did not take; the sheet's draft is gone once the card closes. */
  body: string
  message: string
  /** False after an unanswered post: a blind resend could comment twice. */
  retryable: boolean
}

export type PlaneBoardComments = {
  /** Cards with a post in flight. */
  postingCommentIds: ReadonlySet<string>
  /** Failed posts by card: another card's sheet never sees or resends them. */
  commentFailures: Readonly<Record<string, PlaneBoardCommentFailure>>
  /** Resolves true once Plane has the comment; false keeps the draft on screen. */
  addComment: (item: PlaneBoardEditTarget, body: string) => Promise<boolean>
  retryComment: (item: PlaneBoardEditTarget) => Promise<boolean>
  dismissCommentError: (workItemId: string) => void
  reset: () => void
}

type Input = {
  client: RpcClient | null
  workspaceId: string | null
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _dropped, ...rest } = record
  return rest
}

export function usePlaneBoardComments({ client, workspaceId }: Input): PlaneBoardComments {
  const [postingCommentIds, setPostingCommentIds] = useState<ReadonlySet<string>>(new Set())
  const [commentFailures, setCommentFailures] = useState<
    Readonly<Record<string, PlaneBoardCommentFailure>>
  >({})

  const submit = useCallback(
    async (item: PlaneBoardEditTarget, body: string): Promise<boolean> => {
      if (!client) {
        return false
      }
      setCommentFailures((current) => without(current, item.id))
      setPostingCommentIds((current) => new Set(current).add(item.id))
      const result = await addPlaneWorkItemComment(client, {
        projectId: item.project.id,
        workItemId: item.id,
        workspaceId,
        body
      })
      setPostingCommentIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
      if (result.ok) {
        return true
      }
      // No re-read can settle an unanswered comment (the board shows no thread), so
      // the PM checks the card in Plane instead of a retry that could post it twice.
      setCommentFailures((current) => ({
        ...current,
        [item.id]: {
          body,
          message: result.deliveryUnknown ? PLANE_COMMENT_UNANSWERED_MESSAGE : result.error,
          retryable: !result.deliveryUnknown
        }
      }))
      return false
    },
    [client, workspaceId]
  )

  return {
    postingCommentIds,
    commentFailures,
    addComment: submit,
    retryComment: useCallback(
      async (item: PlaneBoardEditTarget) => {
        const failure = commentFailures[item.id]
        return failure?.retryable ? submit(item, failure.body) : false
      },
      [commentFailures, submit]
    ),
    dismissCommentError: useCallback(
      (workItemId: string) => setCommentFailures((current) => without(current, workItemId)),
      []
    ),
    reset: useCallback(() => setCommentFailures({}), [])
  }
}
