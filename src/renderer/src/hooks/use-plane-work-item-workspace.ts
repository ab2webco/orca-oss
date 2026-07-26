// Why: thin composer over the detail-data and mutations hooks (split apart to
// stay under the 300-line cap), so the component only imports one hook.
import { useAppStore } from '@/store'
import { usePlaneWorkItemDetailData } from './use-plane-work-item-detail-data'
import { usePlaneWorkItemLinkWorktreeAction } from './use-plane-work-item-link-worktree'
import {
  usePlaneWorkItemMutations,
  type PlaneWorkItemActionItem
} from './use-plane-work-item-mutations'
import type {
  PlaneComment,
  PlaneState,
  PlaneUser,
  PlaneWorkItem,
  PlaneWorkItemPriority
} from '../../../shared/plane-types'
import {
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../shared/task-source-context'

export type { PlaneWorkItemActionItem }

export function usePlaneWorkItemWorkspace(
  item: PlaneWorkItem | null,
  sourceContext?: TaskSourceContext | null
): {
  displayed: PlaneWorkItem | null
  itemLoading: boolean
  states: PlaneState[]
  members: PlaneUser[]
  pendingField: string | null
  titleDraft: string
  descriptionDraft: string
  setDescriptionDraft: (value: string) => void
  handleSaveDescription: () => void
  setTitleDraft: (value: string) => void
  labelsDraft: string
  setLabelsDraft: (value: string) => void
  commentDraft: string
  setCommentDraft: (value: string) => void
  commentSubmitting: boolean
  comments: PlaneComment[]
  commentsLoading: boolean
  commentsError: string | null
  canSubmitComment: boolean
  handleSaveTitle: () => void
  handleSaveLabels: () => void
  handleChangeState: (state: PlaneState) => void
  handleChangePriority: (priority: PlaneWorkItemPriority) => void
  handleToggleAssignee: (user: PlaneUser) => void
  handleSubmitComment: () => void
  actionItems: PlaneWorkItemActionItem[]
} {
  const settings = useAppStore((s) => s.settings)
  // Why: unlike Jira, RuntimePlaneSettings has no TaskSourceContext branch yet
  // (see runtime-plane-client.ts), so a source context is converted to plain
  // runtime settings here rather than widening that already-merged contract.
  const providerSettings = sourceContext ? getTaskSourceRuntimeSettings(sourceContext) : settings
  const patchPlaneWorkItem = useAppStore((s) => s.patchPlaneWorkItem)

  const detail = usePlaneWorkItemDetailData(item, providerSettings)
  const mutations = usePlaneWorkItemMutations(detail, providerSettings, patchPlaneWorkItem)
  const linkAction = usePlaneWorkItemLinkWorktreeAction(detail.displayed)

  return {
    displayed: detail.displayed,
    itemLoading: detail.itemLoading,
    states: detail.states,
    members: detail.members,
    titleDraft: detail.titleDraft,
    descriptionDraft: detail.descriptionDraft,
    setDescriptionDraft: detail.setDescriptionDraft,
    setTitleDraft: detail.setTitleDraft,
    labelsDraft: detail.labelsDraft,
    setLabelsDraft: detail.setLabelsDraft,
    comments: detail.comments,
    commentsLoading: detail.commentsLoading,
    commentsError: detail.commentsError,
    ...mutations,
    // Append the link affordance only when an active worktree exists, so
    // worktrees not created from a task can still be attached to this item.
    actionItems: linkAction ? [...mutations.actionItems, linkAction] : mutations.actionItems
  }
}
