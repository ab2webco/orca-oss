import { useCallback, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { readPlaneCommentThread, type PlaneMobileComment } from './plane-work-item-comment-thread'

export type PlaneCommentThreadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PlaneCommentThreadState = {
  status: PlaneCommentThreadStatus
  comments: PlaneMobileComment[]
  error: string | null
}

export type PlaneBoardCommentThread = {
  /** Idle for any card but the one that was read: no thread leaks between sheets. */
  commentThreadFor: (workItemId: string) => PlaneCommentThreadState
  /** Reads a card's thread once; a failed read waits for an explicit retry. */
  loadCommentThread: (workItemId: string, projectId: string) => void
  reloadCommentThread: (workItemId: string, projectId: string) => void
}

type Slot = PlaneCommentThreadState & { workItemId: string | null }

const IDLE: PlaneCommentThreadState = { status: 'idle', comments: [], error: null }
const EMPTY_SLOT: Slot = { ...IDLE, workItemId: null }

type Input = {
  client: RpcClient | null
  workspaceId: string | null
  enabled: boolean
}

export function usePlaneCommentThread({
  client,
  workspaceId,
  enabled
}: Input): PlaneBoardCommentThread {
  const [slot, setSlot] = useState<Slot>(EMPTY_SLOT)
  const generationRef = useRef(0)

  const read = useCallback(
    (workItemId: string, projectId: string): void => {
      if (!client || !enabled) {
        return
      }
      const generation = generationRef.current + 1
      generationRef.current = generation
      setSlot({ ...IDLE, workItemId, status: 'loading' })
      void readPlaneCommentThread(client, { projectId, workItemId, workspaceId }).then((result) => {
        if (generationRef.current !== generation) {
          return
        }
        setSlot(
          result.ok
            ? { workItemId, status: 'ready', comments: result.comments, error: null }
            : { workItemId, status: 'error', comments: [], error: result.error }
        )
      })
    },
    [client, enabled, workspaceId]
  )

  return {
    commentThreadFor: useCallback(
      (workItemId: string) =>
        slot.workItemId === workItemId
          ? { status: slot.status, comments: slot.comments, error: slot.error }
          : IDLE,
      [slot]
    ),
    loadCommentThread: useCallback(
      // Any status for this card counts as read: an auto-retry on error would loop.
      (workItemId: string, projectId: string) => {
        if (slot.workItemId !== workItemId) {
          read(workItemId, projectId)
        }
      },
      [read, slot.workItemId]
    ),
    reloadCommentThread: read
  }
}
