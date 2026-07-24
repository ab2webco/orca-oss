// Why: split out of use-plane-work-item-workspace.ts to stay under the
// 300-line cap — owns fetching the full item, its states/members, and
// comments, plus the title/labels drafts seeded from whichever load resolves.
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  planeGetWorkItem,
  planeListMembers,
  planeListStates,
  planeListWorkItemComments,
  type RuntimePlaneSettings
} from '@/runtime/runtime-plane-client'
import type {
  PlaneComment,
  PlaneState,
  PlaneUser,
  PlaneWorkItem
} from '../../../shared/plane-types'

export type PlaneWorkItemDetailData = {
  displayed: PlaneWorkItem | null
  setDisplayed: (item: PlaneWorkItem | null) => void
  itemLoading: boolean
  states: PlaneState[]
  members: PlaneUser[]
  comments: PlaneComment[]
  setComments: Dispatch<SetStateAction<PlaneComment[]>>
  commentsLoading: boolean
  commentsError: string | null
  optimisticCommentsRef: { current: PlaneComment[] }
  titleDraft: string
  setTitleDraft: (value: string) => void
  labelsDraft: string
  setLabelsDraft: (value: string) => void
}

export function usePlaneWorkItemDetailData(
  item: PlaneWorkItem | null,
  providerSettings: RuntimePlaneSettings
): PlaneWorkItemDetailData {
  const [fullItem, setFullItem] = useState<PlaneWorkItem | null>(null)
  const [itemLoading, setItemLoading] = useState(false)
  const [comments, setComments] = useState<PlaneComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [states, setStates] = useState<PlaneState[]>([])
  const [members, setMembers] = useState<PlaneUser[]>([])
  const [titleDraft, setTitleDraft] = useState('')
  const [labelsDraft, setLabelsDraft] = useState('')
  const requestIdRef = useRef(0)
  const optimisticCommentsRef = useRef<PlaneComment[]>([])

  const loadComments = useCallback(
    async (targetItem: PlaneWorkItem, requestId: number): Promise<void> => {
      setCommentsLoading(true)
      setCommentsError(null)
      try {
        let fetched = await planeListWorkItemComments(
          providerSettings,
          targetItem.project.id,
          targetItem.id,
          targetItem.workspaceId
        )
        if (requestId !== requestIdRef.current) {
          return
        }
        const optimistic = optimisticCommentsRef.current
        if (optimistic.length > 0) {
          const fetchedIds = new Set(fetched.map((comment) => comment.id))
          fetched = [...fetched, ...optimistic.filter((comment) => !fetchedIds.has(comment.id))]
        }
        setComments(fetched)
      } catch (error) {
        if (requestId === requestIdRef.current) {
          setCommentsError(error instanceof Error ? error.message : 'Failed to load comments.')
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setCommentsLoading(false)
        }
      }
    },
    [providerSettings]
  )

  useEffect(() => {
    if (!item) {
      setFullItem(null)
      setItemLoading(false)
      setComments([])
      setCommentsError(null)
      setStates([])
      setMembers([])
      setTitleDraft('')
      setLabelsDraft('')
      optimisticCommentsRef.current = []
      return
    }

    requestIdRef.current += 1
    const requestId = requestIdRef.current
    optimisticCommentsRef.current = []
    setFullItem(item)
    setTitleDraft(item.title)
    setLabelsDraft(item.labels.join(', '))
    setComments([])
    setCommentsError(null)
    setItemLoading(true)

    void planeGetWorkItem(providerSettings, item.id, item.project.id, item.workspaceId)
      .then((result) => {
        if (requestId !== requestIdRef.current || !result) {
          return
        }
        setFullItem(result)
        setTitleDraft(result.title)
        setLabelsDraft(result.labels.join(', '))
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setItemLoading(false)
        }
      })

    void Promise.all([
      planeListStates(providerSettings, item.project.id, item.workspaceId),
      planeListMembers(providerSettings, item.workspaceId)
    ])
      .then(([nextStates, nextMembers]) => {
        if (requestId !== requestIdRef.current) {
          return
        }
        setStates(nextStates)
        setMembers(nextMembers)
      })
      .catch(() => {})

    void loadComments(item, requestId)
  }, [item, loadComments, providerSettings])

  return {
    displayed: fullItem ?? item,
    setDisplayed: setFullItem,
    itemLoading,
    states,
    members,
    comments,
    setComments,
    commentsLoading,
    commentsError,
    optimisticCommentsRef,
    titleDraft,
    setTitleDraft,
    labelsDraft,
    setLabelsDraft
  }
}
