// Why: split out of use-plane-work-item-workspace.ts to stay under the
// 300-line cap — owns every write path (title/labels/state/priority/
// assignees/comments) plus the sidebar action items, given loaded detail data.
import { useCallback, useMemo, useState, type ComponentType } from 'react'
import { buildPlaneWorkItemActions } from './plane-work-item-actions'
import {
  resolvePlaneLabelIds,
  resolvePlaneTitleSave,
  shouldSavePlaneDescription
} from './plane-work-item-field-drafts'
import { toast } from 'sonner'

import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText
} from '@/lib/comment-body-submit-state'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  planeAddWorkItemComment,
  planeGetWorkItem,
  planeUpdateWorkItem,
  type RuntimePlaneSettings
} from '@/runtime/runtime-plane-client'
import { translate } from '@/i18n/i18n'
import type { PlaneWorkItemDetailData } from './use-plane-work-item-detail-data'
import type {
  PlaneComment,
  PlaneState,
  PlaneUser,
  PlaneWorkItem,
  PlaneWorkItemPriority
} from '../../../shared/plane-types'

export type PlaneWorkItemActionItem = {
  label: string
  icon: ComponentType<{ className?: string }>
  action: () => void
}

export function usePlaneWorkItemMutations(
  detail: PlaneWorkItemDetailData,
  providerSettings: RuntimePlaneSettings,
  patchPlaneWorkItem: (workItemId: string, patch: Partial<PlaneWorkItem>) => void
): {
  pendingField: string | null
  commentDraft: string
  setCommentDraft: (value: string) => void
  commentSubmitting: boolean
  canSubmitComment: boolean
  handleSaveTitle: () => void
  handleSaveDescription: () => void
  handleSaveLabels: () => void
  handleChangeState: (state: PlaneState) => void
  handleChangePriority: (priority: PlaneWorkItemPriority) => void
  handleToggleAssignee: (user: PlaneUser) => void
  handleSubmitComment: () => void
  actionItems: PlaneWorkItemActionItem[]
} {
  const { displayed, setDisplayed, setComments, optimisticCommentsRef } = detail
  const [pendingField, setPendingField] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)

  const mutateItem = useCallback(
    async (
      field: string,
      updates: Parameters<typeof planeUpdateWorkItem>[3],
      optimistic?: Partial<PlaneWorkItem>
    ): Promise<void> => {
      if (!displayed || pendingField) {
        return
      }
      setPendingField(field)
      const previous = displayed
      try {
        if (optimistic) {
          setDisplayed({ ...displayed, ...optimistic })
          patchPlaneWorkItem(displayed.id, optimistic)
        }
        const result = await planeUpdateWorkItem(
          providerSettings,
          displayed.project.id,
          displayed.id,
          updates,
          displayed.workspaceId
        )
        if (!result.ok) {
          throw new Error(result.error)
        }
        const latest = await planeGetWorkItem(
          providerSettings,
          displayed.id,
          displayed.project.id,
          displayed.workspaceId
        )
        if (latest) {
          setDisplayed(latest)
          patchPlaneWorkItem(latest.id, latest)
        }
      } catch (error) {
        setDisplayed(previous)
        patchPlaneWorkItem(previous.id, previous)
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.PlaneWorkItemWorkspace.updateFailed',
                'Failed to update Plane work item.'
              )
        )
      } finally {
        setPendingField(null)
      }
    },
    [displayed, patchPlaneWorkItem, pendingField, providerSettings, setDisplayed]
  )

  const handleSaveTitle = useCallback(() => {
    if (!displayed) {
      return
    }
    const save = resolvePlaneTitleSave({ draft: detail.titleDraft, stored: displayed.title })
    if (!save) {
      detail.setTitleDraft(displayed.title)
      return
    }
    void mutateItem('title', save, save)
  }, [detail, displayed, mutateItem])

  const handleSaveDescription = useCallback(() => {
    const description = detail.descriptionDraft
    if (
      !displayed ||
      !shouldSavePlaneDescription({ draft: description, stored: displayed.description })
    ) {
      return
    }
    void mutateItem('description', { description }, { description })
  }, [detail, displayed, mutateItem])

  const handleSaveLabels = useCallback(() => {
    if (!displayed) {
      return
    }
    const labels = resolvePlaneLabelIds(detail.labelsDraft)
    void mutateItem('labels', { labelIds: labels }, { labels })
  }, [detail, displayed, mutateItem])

  const handleChangeState = useCallback(
    (state: PlaneState) => void mutateItem('state', { stateId: state.id }, { state }),
    [mutateItem]
  )

  const handleChangePriority = useCallback(
    (priority: PlaneWorkItemPriority) => void mutateItem('priority', { priority }, { priority }),
    [mutateItem]
  )

  const handleToggleAssignee = useCallback(
    (user: PlaneUser) => {
      if (!displayed) {
        return
      }
      const current = displayed.assignees ?? []
      const nextAssignees = current.some((assignee) => assignee.id === user.id)
        ? current.filter((assignee) => assignee.id !== user.id)
        : [...current, user]
      void mutateItem(
        'assignees',
        { assigneeIds: nextAssignees.map((assignee) => assignee.id) },
        { assignees: nextAssignees }
      )
    },
    [displayed, mutateItem]
  )

  const handleSubmitComment = useCallback((): void => {
    if (!displayed || commentSubmitting) {
      return
    }
    const bodyState = getCommentBodySubmitState(commentDraft)
    if (bodyState.status === 'empty') {
      return
    }
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(
        translate(
          'auto.components.PlaneWorkItemWorkspace.commentTooLarge',
          'Comment is too large to submit safely.'
        )
      )
      return
    }
    setCommentSubmitting(true)
    void planeAddWorkItemComment(
      providerSettings,
      displayed.project.id,
      displayed.id,
      bodyState.body,
      displayed.workspaceId
    )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error)
        }
        const comment: PlaneComment = {
          id: result.id || createBrowserUuid(),
          body: bodyState.body,
          createdAt: new Date().toISOString(),
          user: { id: 'local', displayName: 'You' }
        }
        optimisticCommentsRef.current.push(comment)
        setComments((prev) => [...prev, comment])
        setCommentDraft('')
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.PlaneWorkItemWorkspace.commentFailed',
                'Failed to add comment.'
              )
        )
      })
      .finally(() => setCommentSubmitting(false))
  }, [
    commentDraft,
    commentSubmitting,
    displayed,
    optimisticCommentsRef,
    providerSettings,
    setComments
  ])
  const canSubmitComment = hasBoundedCommentBodyText(commentDraft)

  const actionItems = useMemo(() => buildPlaneWorkItemActions(displayed), [displayed])

  return {
    pendingField,
    commentDraft,
    setCommentDraft,
    commentSubmitting,
    canSubmitComment,
    handleSaveTitle,
    handleSaveDescription,
    handleSaveLabels,
    handleChangeState,
    handleChangePriority,
    handleToggleAssignee,
    handleSubmitComment,
    actionItems
  }
}
