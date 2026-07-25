// Why: split out of PlaneWorkItemWorkspace.tsx to stay under the 400-line cap —
// these are pure presentational panels with no state of their own.
import React from 'react'
import { LoaderCircle, Save, Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { getPlanePriorityLabel } from './plane-work-item-sorter'
import type { PlaneWorkItemActionItem } from '@/hooks/use-plane-work-item-workspace'
import type {
  PlaneComment,
  PlaneState,
  PlaneUser,
  PlaneWorkItem,
  PlaneWorkItemPriority
} from '../../../shared/plane-types'

export const PLANE_PRIORITIES: PlaneWorkItemPriority[] = ['none', 'low', 'medium', 'high', 'urgent']
const CHIP_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:opacity-80 disabled:opacity-50'
const FIELD_BUTTON_CLASS =
  'rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/40 disabled:opacity-50'
const MENU_ITEM_CLASS =
  'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent'

export function planeStateTone(group: string): string {
  if (group === 'completed') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (group === 'started') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200'
  }
  if (group === 'cancelled') {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }
  return 'border-border/50 bg-muted/40 text-muted-foreground'
}

export type PlaneWorkItemEditChipsProps = {
  item: PlaneWorkItem
  states: PlaneState[]
  members: PlaneUser[]
  pendingField: string | null
  onChangeState: (state: PlaneState) => void
  onChangePriority: (priority: PlaneWorkItemPriority) => void
  onToggleAssignee: (user: PlaneUser) => void
}

export function PlaneWorkItemEditChips({
  item,
  states,
  members,
  pendingField,
  onChangeState,
  onChangePriority,
  onToggleAssignee
}: PlaneWorkItemEditChipsProps): React.JSX.Element {
  const assignees = item.assignees ?? []
  return (
    <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2.5">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={pendingField === 'state' || states.length === 0}
            className={cn(CHIP_CLASS, planeStateTone(item.state.group))}
          >
            {item.state.name}
            {pendingField === 'state' ? <LoaderCircle className="size-3 animate-spin" /> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="popover-scroll-content scrollbar-sleek w-52 p-1" align="start">
          {states.map((state) => (
            <button
              key={state.id}
              type="button"
              onClick={() => onChangeState(state)}
              className={MENU_ITEM_CLASS}
            >
              {state.name}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={pendingField === 'priority'}
            className={FIELD_BUTTON_CLASS}
          >
            {getPlanePriorityLabel(item.priority)}
            {pendingField === 'priority' ? (
              <LoaderCircle className="ml-1 inline size-3 animate-spin" />
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="popover-scroll-content scrollbar-sleek w-40 p-1" align="start">
          {PLANE_PRIORITIES.map((priority) => (
            <button
              key={priority}
              type="button"
              onClick={() => onChangePriority(priority)}
              className={MENU_ITEM_CLASS}
            >
              {getPlanePriorityLabel(priority)}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={pendingField === 'assignees'}
            className={FIELD_BUTTON_CLASS}
          >
            {assignees.length > 0
              ? assignees.map((assignee) => assignee.displayName).join(', ')
              : translate('auto.components.PlaneWorkItemWorkspace.addAssignee', '+ Assignee')}
            {pendingField === 'assignees' ? (
              <LoaderCircle className="ml-1 inline size-3 animate-spin" />
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="popover-scroll-content scrollbar-sleek w-56 p-1" align="start">
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => onToggleAssignee(member)}
              className={cn(
                MENU_ITEM_CLASS,
                assignees.some((assignee) => assignee.id === member.id) && 'bg-accent/50'
              )}
            >
              {member.displayName}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}

export type PlaneWorkItemFieldsSectionProps = {
  titleDraft: string
  onTitleDraftChange: (value: string) => void
  onSaveTitle: () => void
  labelsDraft: string
  onLabelsDraftChange: (value: string) => void
  onSaveLabels: () => void
  pendingField: string | null
}

export function PlaneWorkItemFieldsSection({
  titleDraft,
  onTitleDraftChange,
  onSaveTitle,
  labelsDraft,
  onLabelsDraftChange,
  onSaveLabels,
  pendingField
}: PlaneWorkItemFieldsSectionProps): React.JSX.Element {
  return (
    <section className="border-b border-border/40 px-4 py-4">
      <div className="grid gap-2">
        <label className="text-[11px] font-medium text-muted-foreground">
          {translate('auto.components.PlaneWorkItemWorkspace.title', 'Title')}
        </label>
        <div className="flex gap-2">
          <Input
            value={titleDraft}
            onChange={(event) => onTitleDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                onSaveTitle()
              }
            }}
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={onSaveTitle}
            disabled={pendingField === 'title'}
          >
            {pendingField === 'title' ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
          </Button>
        </div>
        <label className="mt-2 text-[11px] font-medium text-muted-foreground">
          {translate('auto.components.PlaneWorkItemWorkspace.labels', 'Labels')}
        </label>
        <div className="flex gap-2">
          <Input
            value={labelsDraft}
            onChange={(event) => onLabelsDraftChange(event.target.value)}
            placeholder={translate(
              'auto.components.PlaneWorkItemWorkspace.labelsPlaceholder',
              'backend, bug'
            )}
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={onSaveLabels}
            disabled={pendingField === 'labels'}
          >
            {pendingField === 'labels' ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </section>
  )
}

export function PlaneWorkItemActionRail({
  actions
}: {
  actions: PlaneWorkItemActionItem[]
}): React.JSX.Element {
  return (
    <div className="grid gap-1">
      {actions.map((item) => {
        const Icon = item.icon
        return (
          <Tooltip key={item.label}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={item.action}
                className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={6}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

export type PlaneWorkItemCommentsListProps = {
  comments: PlaneComment[]
  commentsLoading: boolean
  commentsError: string | null
  formatRelativeTime: (input: string) => string
}

export function PlaneWorkItemCommentsList({
  comments,
  commentsLoading,
  commentsError,
  formatRelativeTime
}: PlaneWorkItemCommentsListProps): React.JSX.Element {
  return (
    <section className="px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[13px] font-medium text-foreground">
          {translate('auto.components.PlaneWorkItemWorkspace.comments', 'Comments')}
        </span>
        {comments.length > 0 ? (
          <span className="text-[12px] text-muted-foreground">{comments.length}</span>
        ) : null}
      </div>
      {commentsError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {commentsError}
        </div>
      ) : commentsLoading && comments.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('auto.components.PlaneWorkItemWorkspace.noComments', 'No comments yet.')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {comments.map((comment) => (
            <div key={comment.id} className="rounded-md border border-border/50 bg-muted/20">
              <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-2">
                <span className="truncate text-[13px] font-semibold text-foreground">
                  {comment.user?.displayName ??
                    translate('auto.components.PlaneWorkItemWorkspace.unknownUser', 'Unknown')}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {formatRelativeTime(comment.createdAt)}
                </span>
              </div>
              <div className="px-3 py-2">
                <CommentMarkdown content={comment.body} className="text-[13px] leading-relaxed" />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export type PlaneWorkItemCommentComposerProps = {
  commentDraft: string
  onCommentDraftChange: (value: string) => void
  commentSubmitting: boolean
  canSubmitComment: boolean
  onSubmitComment: () => void
}

export function PlaneWorkItemCommentComposer({
  commentDraft,
  onCommentDraftChange,
  commentSubmitting,
  canSubmitComment,
  onSubmitComment
}: PlaneWorkItemCommentComposerProps): React.JSX.Element {
  return (
    <div className="flex-none border-t border-border/50 bg-background px-3 py-3">
      <div className="flex gap-2">
        <textarea
          value={commentDraft}
          onChange={(event) => onCommentDraftChange(event.target.value)}
          placeholder={translate(
            'auto.components.PlaneWorkItemWorkspace.commentPlaceholder',
            'Add a Plane comment...'
          )}
          rows={2}
          disabled={commentSubmitting}
          className="min-h-10 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button
          onClick={onSubmitComment}
          disabled={!canSubmitComment || commentSubmitting}
          className="self-end gap-2"
        >
          {commentSubmitting ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {translate('auto.components.PlaneWorkItemWorkspace.comment', 'Comment')}
        </Button>
      </div>
    </div>
  )
}
