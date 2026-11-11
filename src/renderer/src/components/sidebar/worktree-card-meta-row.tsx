import React from 'react'
import { GitMerge } from 'lucide-react'

import { DetachedHeadBadge } from '@/components/DetachedHeadBadge'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import { Badge } from '@/components/ui/badge'
import CacheTimer from './CacheTimer'
import { CONFLICT_OPERATION_LABELS } from './WorktreeCardHelpers'
import { TruncatedSidebarLabel } from './truncated-sidebar-label'
import { getDirectoryName } from './worktree-card-model'
import type { WorktreeCardPresentation } from './worktree-card-presentation'
import type { WorktreeCardController } from './use-worktree-card-controller'

export function WorktreeCardMetaRow({
  card,
  presentation
}: {
  card: WorktreeCardController
  presentation: WorktreeCardPresentation
}): React.JSX.Element {
  const {
    worktree,
    repo,
    identityDisplay,
    showIdentityInNewCard,
    branch,
    detachedHeadDisplay,
    isFolder,
    newCardStyle,
    conflictOperation,
    cacheStartedAt,
    cacheTtlMs
  } = card
  const {
    showRepoBadgeInMetaRow,
    hasHoverDetails,
    showBranch,
    showDetachedHeadInMetaRow,
    showConflictOperationBadge,
    showMetaRowDetails,
    detailsAndPorts
  } = presentation

  return (
    <div className="flex items-center gap-1.5 min-w-0" data-worktree-card-meta-row="">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {showRepoBadgeInMetaRow && repo && (
          <div className="flex items-center gap-1.5 shrink-0 px-1.5 py-0.5 rounded-[4px] bg-accent border border-border dark:bg-accent/50 dark:border-border/60">
            <RepoBadgeMark color={repo.badgeColor} />
            <span className="text-[10px] font-semibold text-foreground truncate max-w-[6rem] leading-none lowercase">
              {repo.displayName}
            </span>
          </div>
        )}

        {/* Why no host, and branch or HEAD only on opt-in: V30 draws the row as one line (ORCA-1149). */}
        {showIdentityInNewCard ? (
          <TruncatedSidebarLabel
            text={identityDisplay!}
            className="text-[11px] text-muted-foreground leading-none"
            tooltipEnabled={!hasHoverDetails}
          />
        ) : showBranch ? (
          <TruncatedSidebarLabel
            text={branch}
            className="text-[11px] text-muted-foreground leading-none"
            // Why: whole-card details hover already shows full identity; a nested tooltip would compete for it.
            tooltipEnabled={!hasHoverDetails}
          />
        ) : showDetachedHeadInMetaRow && detachedHeadDisplay ? (
          <DetachedHeadBadge
            display={detachedHeadDisplay}
            label="sidebar"
            side="right"
            className="h-[16px]"
          />
        ) : isFolder && !newCardStyle ? (
          <span
            className="min-w-0 truncate font-mono text-[11px] leading-none text-muted-foreground"
            title={worktree.path}
          >
            {getDirectoryName(worktree.path)}
          </span>
        ) : null}

        {showConflictOperationBadge && (
          <Badge
            variant="outline"
            className="h-[16px] px-1.5 text-[10px] font-medium rounded shrink-0 gap-1 text-status-warning border-status-warning/30 bg-status-warning/5 leading-none"
          >
            <GitMerge className="size-2.5" />
            {CONFLICT_OPERATION_LABELS[conflictOperation]}
          </Badge>
        )}

        {cacheStartedAt != null && <CacheTimer startedAt={cacheStartedAt} ttlMs={cacheTtlMs} />}
      </div>

      {showMetaRowDetails && (
        <div className="ml-auto flex shrink-0 items-center gap-1 pr-1.5">{detailsAndPorts}</div>
      )}
    </div>
  )
}
