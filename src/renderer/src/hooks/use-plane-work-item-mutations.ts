// Why: split out of use-plane-work-item-workspace.ts to stay under the
// 300-line cap — owns every write path (title/labels/state/priority/
// assignees/comments) plus the sidebar action items, given loaded detail data.
import { useCallback, useMemo, useState, type ComponentType } from 'react'
import { Clipboard, ExternalLink, GitBranch } from 'lucide-react'
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

function buildPlaneBranchName(title: string, identifier: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52)
  return `${identifier.toLowerCase()}${slug ? `-${slug}` : ''}`
}

async function copyTextToClipboard(text: string, label: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(text)
    toast.success(
      translate('auto.components.PlaneWorkItemWorkspace.copied', '{{value0}} copied', {
        value0: label
      })
    )
  } catch {
    toast.error(
      translate('auto.components.PlaneWorkItemWorkspace.copyFailed', 'Failed to copy {{value0}}', {
        value0: label.toLowerCase()
      })
    )
  }
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
    const title = detail.titleDraft.trim()
    if (!title || title === displayed.title) {
      detail.setTitleDraft(displayed.title)
      return
    }
    void mutateItem('title', { title }, { title })
  }, [detail, displayed, mutateItem])

  const handleSaveLabels = useCallback(() => {
    if (!displayed) {
      return
    }
    const labels = detail.labelsDraft
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean)
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

  const actionItems = useMemo((): PlaneWorkItemActionItem[] => {
    if (!displayed) {
      return []
    }
    return [
      {
        label: translate('auto.components.PlaneWorkItemWorkspace.openInPlane', 'Open in Plane'),
        icon: ExternalLink,
        action: () => window.api.shell.openUrl(displayed.url)
      },
      {
        label: translate('auto.components.PlaneWorkItemWorkspace.copyUrl', 'Copy URL'),
        icon: Clipboard,
        action: () => void copyTextToClipboard(displayed.url, 'URL')
      },
      {
        label: translate('auto.components.PlaneWorkItemWorkspace.copyId', 'Copy identifier'),
        icon: Clipboard,
        action: () => void copyTextToClipboard(displayed.identifier, 'Identifier')
      },
      {
        label: translate(
          'auto.components.PlaneWorkItemWorkspace.copyBranch',
          'Copy suggested branch name'
        ),
        icon: GitBranch,
        action: () =>
          void copyTextToClipboard(
            buildPlaneBranchName(displayed.title, displayed.identifier),
            'Branch name'
          )
      },
      {
        label: translate('auto.components.PlaneWorkItemWorkspace.copyPrompt', 'Copy prompt'),
        icon: Clipboard,
        action: () =>
          void copyTextToClipboard(
            `Complete Plane work item ${displayed.identifier}: ${displayed.title}\n\n${displayed.url}`,
            'Prompt'
          )
      }
    ]
  }, [displayed])

  return {
    pendingField,
    commentDraft,
    setCommentDraft,
    commentSubmitting,
    canSubmitComment,
    handleSaveTitle,
    handleSaveLabels,
    handleChangeState,
    handleChangePriority,
    handleToggleAssignee,
    handleSubmitComment,
    actionItems
  }
}
