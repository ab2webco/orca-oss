import React from 'react'
import { LoaderCircle } from 'lucide-react'

import { cn } from '@/lib/utils'
import { AutoRenameFailedDialog } from './AutoRenameFailedDialog'
import WorktreeContextMenu from './WorktreeContextMenu'
import { WorktreeCardDetailsHover } from './WorktreeCardMeta'
import { WorktreeCardPortsDetails } from './WorktreeCardPorts'
import { WorktreeCardAgentHoverDetails } from './WorktreeCardAgentHoverDetails'
import { WorktreeCardRowContent, WorktreeCardTeamChildren } from './worktree-card-row-content'
import { useSidebarTeamCard } from './sidebar-team-roster'
import { buildWorktreeCardPresentation } from './worktree-card-presentation'
import type { WorktreeCardController } from './use-worktree-card-controller'

export function WorktreeCardSurface({ card }: { card: WorktreeCardController }): React.JSX.Element {
  const presentation = buildWorktreeCardPresentation(card)
  const {
    worktree,
    selectedWorktrees,
    onAssignWorkspaceStatus,
    affiliateListMode,
    isActiveSurface,
    activeSurfaceVariant,
    isMultiSelected,
    revealHighlight,
    revealHighlightTone,
    flushSurface,
    isLineageDropTarget,
    nativeDragEnabled,
    lineageChildren,
    lineageChildrenStyle,
    newCardStyle,
    titleRenaming,
    isDeleting,
    isRuntimeDisconnected,
    isQueuedForDeletion,
    deleteLabel,
    handleClick,
    handleDoubleClick,
    handleDragStart,
    handleDragEnd,
    handleContextMenuSelect,
    hoverIssue,
    hoverLinearIssue,
    hoverPlaneWorkItem,
    hoverJiraIssue,
    hoverReview,
    hoverComment,
    metaAutomationProvenance,
    metaCliProvenance,
    workspacePorts,
    detailsHoverControl,
    handleRenameTitle,
    handleEditIssue,
    handleEditComment,
    handleOpenGitHubIssueInOrca,
    linearIssue,
    planeWorkItem,
    handleOpenLinearIssueInOrca,
    handleOpenPlaneWorkItemInOrca,
    handleOpenReviewInOrca,
    handleOpenAutomation,
    handleOpenAutomationRun,
    hasExplicitLinkedReview,
    handleUnlinkReview,
    showRenameErrorDialog,
    setShowRenameErrorDialog
  } = card
  const { titleOnlyCard, hasHoverDetails, hoverBranchName, hoverWorkspaceTitle, cardStyle } =
    presentation

  const team = useSidebarTeamCard(worktree.id)
  const teamCard = team.row !== null
  // Why: V30 marks only the open agent's row; a lead's card wraps its members' rows, so it never
  // lights up for an open member, and its own selection fills its row (main.css), not a card.
  const surfaceActive = isActiveSurface && (!teamCard || card.isActive)
  const parentCardContent = (
    <WorktreeCardRowContent
      card={card}
      row={team.row}
      child={team.child}
      presentation={presentation}
    />
  )

  const parentHoverTriggerBody = (
    <div className="group/worktree-card w-full min-w-0" data-worktree-card-hover-trigger="">
      {parentCardContent}
    </div>
  )

  const parentCardBodyWithHoverDetails =
    hasHoverDetails && !titleRenaming && !card.activityViewOpen ? (
      <WorktreeCardDetailsHover
        issue={hoverIssue}
        linearIssue={hoverLinearIssue}
        planeWorkItem={hoverPlaneWorkItem}
        jiraIssue={hoverJiraIssue}
        review={hoverReview}
        comment={hoverComment}
        automationProvenance={metaAutomationProvenance}
        cliProvenance={metaCliProvenance}
        automationHostId={worktree.hostId}
        branchName={hoverBranchName}
        workspaceTitle={hoverWorkspaceTitle}
        workspaceTitleRenameDisabled={isDeleting || affiliateListMode}
        detailsAfter={
          <>
            <WorktreeCardAgentHoverDetails worktree={worktree} repo={card.repo} />
            {workspacePorts.length > 0 ? <WorktreeCardPortsDetails ports={workspacePorts} /> : null}
          </>
        }
        openDelay={100}
        hoverControl={detailsHoverControl}
        onRenameWorkspaceTitle={affiliateListMode ? undefined : handleRenameTitle}
        onEditIssue={affiliateListMode ? undefined : handleEditIssue}
        onEditComment={affiliateListMode ? undefined : handleEditComment}
        onOpenGitHubIssueInOrca={
          hoverIssue && 'url' in hoverIssue && hoverIssue.url
            ? handleOpenGitHubIssueInOrca
            : undefined
        }
        onOpenLinearIssueInOrca={linearIssue?.url ? handleOpenLinearIssueInOrca : undefined}
        onOpenPlaneWorkItemInOrca={planeWorkItem ? handleOpenPlaneWorkItemInOrca : undefined}
        onOpenReviewInOrca={
          hoverReview?.url && hoverReview.provider === 'github' ? handleOpenReviewInOrca : undefined
        }
        onOpenAutomation={affiliateListMode ? undefined : handleOpenAutomation}
        onOpenAutomationRun={affiliateListMode ? undefined : handleOpenAutomationRun}
        // Why: branch lookup can surface a review without persisted metadata; only unlink when explicitly linked.
        onUnlinkReview={
          !affiliateListMode && hasExplicitLinkedReview ? handleUnlinkReview : undefined
        }
      >
        {parentHoverTriggerBody}
      </WorktreeCardDetailsHover>
    ) : (
      parentHoverTriggerBody
    )

  const cardBody = (
    <div
      className={cn(
        'relative flex cursor-pointer flex-col transition-[background-color,border-color,opacity,box-shadow] duration-200 outline-none select-none',
        // Why: V30's rows share one height, so a team card adds no padding of its own around its row.
        team.row ? 'py-0' : titleOnlyCard ? 'py-2' : 'pt-1.25 pb-1.5',
        // Why: under the lead the child row takes V30's step; the tree's own insets would add to it.
        team.child
          ? 'w-full pl-2'
          : ['pr-1.5', flushSurface ? 'ml-1 w-[calc(100%-0.25rem)]' : 'ml-1'],
        'rounded-lg',
        // Why: the live data attribute updates before React state during navigation,
        // so it must own the complete active style without stale utility classes.
        isLineageDropTarget
          ? 'border border-accent-foreground/20 bg-accent/80'
          : surfaceActive
            ? 'border border-transparent'
            : isMultiSelected
              ? 'border border-worktree-sidebar-ring/35 bg-worktree-sidebar-accent/70 ring-1 ring-worktree-sidebar-ring/30'
              : teamCard
                ? 'border border-transparent'
                : 'border border-transparent worktree-sidebar-card-hover',
        surfaceActive && isMultiSelected && 'ring-1 ring-worktree-sidebar-ring/35',
        revealHighlight && [
          'scroll-to-current-workspace-reveal-highlight',
          revealHighlightTone === 'ai' && 'scroll-to-current-workspace-reveal-highlight--ai'
        ],
        titleRenaming && '!border-transparent !bg-transparent !shadow-none !ring-0',
        isDeleting && 'opacity-50 grayscale cursor-not-allowed',
        // Why: no SSH dim — the inline host control now states the disconnected state
        // explicitly, and a subtree opacity would composite its destructive tint and spinner
        // down to an illegible alpha (a descendant cannot escape an ancestor's opacity).
        isRuntimeDisconnected && !isDeleting && 'opacity-60'
      )}
      data-worktree-card-surface="true"
      data-worktree-card-active={surfaceActive ? activeSurfaceVariant : undefined}
      data-worktree-card-team={teamCard ? '' : undefined}
      onClick={handleClick}
      onDoubleClick={affiliateListMode ? undefined : handleDoubleClick}
      draggable={!affiliateListMode && nativeDragEnabled && !isDeleting && !titleRenaming}
      onDragStart={!affiliateListMode && nativeDragEnabled ? handleDragStart : undefined}
      onDragEnd={!affiliateListMode && nativeDragEnabled ? handleDragEnd : undefined}
      aria-busy={isDeleting}
      style={team.child ? undefined : cardStyle}
    >
      {isDeleting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/50 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-[11px] font-medium text-foreground shadow-sm border border-border/50">
            {!isQueuedForDeletion ? (
              <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
            {deleteLabel}
          </div>
        </div>
      )}
      {parentCardBodyWithHoverDetails}
      {/* Why outside the hover trigger: pointing at a member must open only that member's card. */}
      {teamCard ? <WorktreeCardTeamChildren card={card} /> : null}

      {/* Why not for a team card: its content draws the children as V30's child rows. */}
      {newCardStyle && lineageChildren && !team.row ? (
        <div
          className="mt-1.5 space-y-1"
          data-worktree-lineage-children=""
          style={lineageChildrenStyle}
        >
          {lineageChildren}
        </div>
      ) : null}
    </div>
  )

  return (
    <>
      {affiliateListMode ? (
        cardBody
      ) : (
        <WorktreeContextMenu
          worktree={worktree}
          selectedWorktrees={selectedWorktrees}
          onContextMenuSelect={handleContextMenuSelect}
          onAssignWorkspaceStatus={onAssignWorkspaceStatus}
        >
          {cardBody}
        </WorktreeContextMenu>
      )}

      {typeof worktree.firstAgentMessageRenameError === 'string' &&
        worktree.firstAgentMessageRenameError.length > 0 && (
          <AutoRenameFailedDialog
            open={showRenameErrorDialog}
            onOpenChange={setShowRenameErrorDialog}
            worktreeId={worktree.id}
            worktreeName={worktree.displayName}
            error={worktree.firstAgentMessageRenameError}
          />
        )}
    </>
  )
}
