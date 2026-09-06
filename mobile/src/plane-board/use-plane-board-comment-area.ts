import { useCallback } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  arePlaneCommentsReadableByHost,
  isPlaneBoardWritableByHost
} from './plane-board-writes-capability'
import { usePlaneBoardComments, type PlaneBoardComments } from './use-plane-board-comments'
import { usePlaneCommentThread, type PlaneBoardCommentThread } from './use-plane-comment-thread'
import type { PlaneBoardEditTarget } from './use-plane-board-edits'

export type PlaneBoardCommentArea = Omit<PlaneBoardComments, 'reset'> &
  PlaneBoardCommentThread & {
    /** Posting rides the same host gate as create. */
    canComment: boolean
    /** False on a host that refuses the thread read; the sheet shows no comment area at all. */
    canReadComments: boolean
    reset: () => void
  }

type Input = {
  client: RpcClient | null
  workspaceId: string | null
  capabilities: readonly string[] | undefined
}

/** The write side and the read side of one thread, so a post is re-read where it landed. */
export function usePlaneBoardCommentArea({
  client,
  workspaceId,
  capabilities
}: Input): PlaneBoardCommentArea {
  const { addComment, ...comments } = usePlaneBoardComments({ client, workspaceId })
  const canReadComments = arePlaneCommentsReadableByHost(capabilities)
  const thread = usePlaneCommentThread({ client, workspaceId, enabled: canReadComments })
  const { reloadCommentThread } = thread
  // A posted comment is only proof once it comes back in the thread.
  const addAndReread = useCallback(
    async (item: PlaneBoardEditTarget, body: string): Promise<boolean> => {
      const posted = await addComment(item, body)
      if (posted) {
        reloadCommentThread(item.id, item.project.id)
      }
      return posted
    },
    [addComment, reloadCommentThread]
  )
  return {
    ...comments,
    ...thread,
    addComment: addAndReread,
    canComment: isPlaneBoardWritableByHost(capabilities),
    canReadComments
  }
}
