import React from 'react'
import { ArrowRight, LoaderCircle, X } from 'lucide-react'
import { VisuallyHidden } from 'radix-ui'

import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { usePlaneWorkItemWorkspace } from '@/hooks/use-plane-work-item-workspace'
import { translate } from '@/i18n/i18n'
import {
  PlaneWorkItemActionRail,
  PlaneWorkItemCommentComposer,
  PlaneWorkItemCommentsList,
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
  const assignees = displayed?.assignees ?? []

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(92vw,780px)] p-0 sm:max-w-[780px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <VisuallyHidden.Root asChild>
          <SheetTitle>
            {displayed?.title ??
              translate('auto.components.PlaneWorkItemWorkspace.sheetTitle', 'Plane work item')}
          </SheetTitle>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root asChild>
          <SheetDescription>
            {translate(
              'auto.components.PlaneWorkItemWorkspace.sheetDescription',
              'Preview, edit, and start work from the selected work item.'
            )}
          </SheetDescription>
        </VisuallyHidden.Root>

        {displayed ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
            <div className="flex-none border-b border-border/50 bg-muted/30 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{displayed.identifier}</span>
                    {displayed.workspaceSlug ? <span>{displayed.workspaceSlug}</span> : null}
                    <span>{displayed.project.identifier}</span>
                    <span>{formatRelativeTime(displayed.updatedAt)}</span>
                    {workspace.itemLoading ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : null}
                  </div>
                  <h2 className="mt-1 text-[20px] font-semibold leading-tight text-foreground">
                    {displayed.title}
                  </h2>
                </div>
                <Button
                  onClick={() => onUse(displayed)}
                  size="sm"
                  className="hidden shrink-0 gap-2 sm:inline-flex"
                >
                  {translate(
                    'auto.components.PlaneWorkItemWorkspace.startWorkspace',
                    'Start workspace'
                  )}
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

            <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_228px]">
              <div className="min-h-0 overflow-y-auto scrollbar-sleek">
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
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <PlaneIcon className="size-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground">
                      {displayed.project.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {displayed.identifier} ·{' '}
                      {assignees.length > 0
                        ? assignees.map((assignee) => assignee.displayName).join(', ')
                        : translate(
                            'auto.components.PlaneWorkItemWorkspace.unassigned',
                            'Unassigned'
                          )}
                    </span>
                  </div>
                  {displayed.description?.trim() ? (
                    <CommentMarkdown
                      content={displayed.description}
                      variant="document"
                      className="text-[14px] leading-relaxed"
                    />
                  ) : (
                    <p className="text-sm italic text-muted-foreground">
                      {translate(
                        'auto.components.PlaneWorkItemWorkspace.noDescription',
                        'No description provided.'
                      )}
                    </p>
                  )}
                </section>

                <PlaneWorkItemCommentsList
                  comments={workspace.comments}
                  commentsLoading={workspace.commentsLoading}
                  commentsError={workspace.commentsError}
                  formatRelativeTime={formatRelativeTime}
                />
              </div>

              <aside className="border-t border-border/50 bg-muted/20 px-3 py-3 xl:border-l xl:border-t-0">
                <Button
                  onClick={() => onUse(displayed)}
                  className="mb-3 w-full justify-center gap-2 sm:hidden"
                >
                  {translate(
                    'auto.components.PlaneWorkItemWorkspace.startWorkspace',
                    'Start workspace'
                  )}
                  <ArrowRight className="size-4" />
                </Button>
                <PlaneWorkItemActionRail actions={workspace.actionItems} />
              </aside>
            </div>

            <PlaneWorkItemCommentComposer
              commentDraft={workspace.commentDraft}
              onCommentDraftChange={workspace.setCommentDraft}
              commentSubmitting={workspace.commentSubmitting}
              canSubmitComment={workspace.canSubmitComment}
              onSubmitComment={workspace.handleSubmitComment}
            />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
