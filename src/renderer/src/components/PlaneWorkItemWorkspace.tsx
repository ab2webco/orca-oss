import React from 'react'
import { ArrowRight, LoaderCircle, X } from 'lucide-react'

import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePlaneWorkItemWorkspace } from '@/hooks/use-plane-work-item-workspace'
import { translate } from '@/i18n/i18n'
import {
  PlaneWorkItemActionsRow,
  PlaneWorkItemCommentsSection,
  PlaneWorkItemEditChips,
  PlaneWorkItemFieldsSection
} from './plane-work-item-workspace-panels'
import type { PlaneWorkItem } from '../../../shared/plane-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'

type PlaneWorkItemWorkspaceProps = {
  item: PlaneWorkItem | null
  onUse: (item: PlaneWorkItem) => void
  onClose: () => void
  sourceContext?: TaskSourceContext | null
}

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function formatRelativeTime(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return 'recently'
  }
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  if (Math.abs(diffMinutes) < 60) {
    return relativeFormatter.format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, 'hour')
  }
  return relativeFormatter.format(Math.round(diffHours / 24), 'day')
}

export default function PlaneWorkItemWorkspace({
  item,
  onUse,
  onClose,
  sourceContext
}: PlaneWorkItemWorkspaceProps): React.JSX.Element {
  const workspace = usePlaneWorkItemWorkspace(item, sourceContext)
  const { displayed } = workspace

  if (!displayed) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 border-l border-border/50 bg-background px-6 text-center">
        <PlaneIcon className="size-6 text-muted-foreground opacity-40" />
        <p className="text-sm text-muted-foreground">
          {translate(
            'auto.components.PlaneWorkItemWorkspace.emptyState',
            'Select a work item to preview it here.'
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border/50 bg-background">
      <div className="flex-none border-b border-border/50 bg-muted/30 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="font-mono">{displayed.identifier}</span>
              {displayed.workspaceSlug ? <span>{displayed.workspaceSlug}</span> : null}
              <span>{displayed.project.identifier}</span>
              <span>{formatRelativeTime(displayed.updatedAt)}</span>
              {workspace.itemLoading ? <LoaderCircle className="size-3 animate-spin" /> : null}
            </div>
            <h2 className="mt-1 text-[18px] font-semibold leading-tight text-foreground">
              {displayed.title}
            </h2>
          </div>
          <Button
            onClick={() => onUse(displayed)}
            size="sm"
            className="hidden shrink-0 gap-2 sm:inline-flex"
          >
            {translate('auto.components.PlaneWorkItemWorkspace.startWorkspace', 'Start workspace')}
            <ArrowRight className="size-4" />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={onClose}
                aria-label={translate(
                  'auto.components.PlaneWorkItemWorkspace.close',
                  'Close Plane work item preview'
                )}
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.PlaneWorkItemWorkspace.closeShort', 'Close')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <PlaneWorkItemEditChips
        item={displayed}
        states={workspace.states}
        members={workspace.members}
        pendingField={workspace.pendingField}
        onChangeState={workspace.handleChangeState}
        onChangePriority={workspace.handleChangePriority}
        onToggleAssignee={workspace.handleToggleAssignee}
      />

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        <PlaneWorkItemFieldsSection
          titleDraft={workspace.titleDraft}
          onTitleDraftChange={workspace.setTitleDraft}
          onSaveTitle={workspace.handleSaveTitle}
          labelsDraft={workspace.labelsDraft}
          onLabelsDraftChange={workspace.setLabelsDraft}
          onSaveLabels={workspace.handleSaveLabels}
          pendingField={workspace.pendingField}
        />

        <section className="border-b border-border/40 px-4 py-4">
          {displayed.description?.trim() ? (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
              {displayed.description}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              {translate(
                'auto.components.PlaneWorkItemWorkspace.noDescription',
                'No description provided.'
              )}
            </p>
          )}
        </section>

        <PlaneWorkItemActionsRow actions={workspace.actionItems} />

        <PlaneWorkItemCommentsSection
          comments={workspace.comments}
          commentsLoading={workspace.commentsLoading}
          commentsError={workspace.commentsError}
          commentDraft={workspace.commentDraft}
          onCommentDraftChange={workspace.setCommentDraft}
          commentSubmitting={workspace.commentSubmitting}
          canSubmitComment={workspace.canSubmitComment}
          onSubmitComment={workspace.handleSubmitComment}
          formatRelativeTime={formatRelativeTime}
        />
      </div>
    </div>
  )
}
