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
  descriptionDraft: string
  setDescriptionDraft: (value: string) => void
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
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [labelsDraft, setLabelsDraft] = useState('')
  const requestIdRef = useRef(0)
  const optimisticCommentsRef = useRef<PlaneComment[]>([])
  // Why: the caller recomputes providerSettings fresh each render; holding it in a
  // ref keeps loadComments + the load effect stable so they don't re-run every
  // render (which caused a setState→render→effect infinite loop, max-update-depth).
  const providerSettingsRef = useRef(providerSettings)
  // Why an effect and not a plain render write: React can replay or discard a
  // render, so a mutation there can leak from UI that never commits. Declared
  // ahead of the loaders below so it has already run when they fire.
  useEffect(() => {
    providerSettingsRef.current = providerSettings
  })

  const loadComments = useCallback(
    async (targetItem: PlaneWorkItem, requestId: number): Promise<void> => {
      setCommentsLoading(true)
      setCommentsError(null)
      try {
        let fetched = await planeListWorkItemComments(
          providerSettingsRef.current,
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
    []
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
      setDescriptionDraft('')
      setLabelsDraft('')
      optimisticCommentsRef.current = []
      return
    }

    requestIdRef.current += 1
    const requestId = requestIdRef.current
    optimisticCommentsRef.current = []
    setFullItem(item)
    setTitleDraft(item.title)
    setDescriptionDraft(item.description ?? '')
    setLabelsDraft(item.labels.join(', '))
    setComments([])
    setCommentsError(null)
    setItemLoading(true)

    void planeGetWorkItem(providerSettingsRef.current, item.id, item.project.id, item.workspaceId)
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
      planeListStates(providerSettingsRef.current, item.project.id, item.workspaceId),
      planeListMembers(providerSettingsRef.current, item.workspaceId, item.project.id)
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
  }, [item, loadComments])

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
    descriptionDraft,
    setDescriptionDraft,
    setTitleDraft,
    labelsDraft,
    setLabelsDraft
  }
}
