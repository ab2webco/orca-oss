import React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import { activateWorktreeFromSidebar } from '@/lib/sidebar-worktree-activation'
import { getRepoExecutionHostId } from '../../../../../../shared/execution-host'
import type { Repo } from '../../../../../../shared/repo-types'
import type { IdleProjectFold } from '../grouping/row-types'
import { handleRepoHeaderCollapseAffordancePointerDown } from './header-event-guards'

/** A one-workspace project has nothing to unfold, unless a reveal already opened it. */
export function hasIdleProjectFoldChevron(fold: IdleProjectFold): boolean {
  return fold.workspaceCount > 1 || fold.state === 'open'
}

export function activateIdleProjectWorkspace(fold: IdleProjectFold, repo: Repo | undefined): void {
  const worktree = fold.openWorktree
  void activateWorktreeFromSidebar(
    worktree.id,
    worktree.hostId ?? (repo ? getRepoExecutionHostId(repo) : undefined)
  )
}

export type IdleProjectFoldKeyAction = 'open-workspace' | 'toggle-fold' | null

/** Enter/Space open the workspace; ArrowRight unfolds and ArrowLeft folds, as in a tree. */
export function getIdleProjectFoldKeyAction(
  key: string,
  fold: IdleProjectFold
): IdleProjectFoldKeyAction {
  if (key === 'Enter' || key === ' ') {
    return 'open-workspace'
  }
  if (!hasIdleProjectFoldChevron(fold)) {
    return null
  }
  if (
    (key === 'ArrowRight' && fold.state === 'folded') ||
    (key === 'ArrowLeft' && fold.state === 'open')
  ) {
    return 'toggle-fold'
  }
  return null
}

export function IdleProjectFoldChevron({
  fold,
  label,
  paddingLeft,
  onToggle
}: {
  fold: IdleProjectFold
  label: string
  paddingLeft: number
  onToggle: () => void
}): React.JSX.Element {
  const open = fold.state === 'open'
  return (
    <button
      type="button"
      tabIndex={-1}
      data-idle-project-fold-chevron=""
      aria-label={
        open
          ? translate('auto.components.sidebar.IdleProjectFold.fold', 'Fold {{project}}', {
              project: label
            })
          : translate(
              'auto.components.sidebar.IdleProjectFold.unfold',
              'Show workspaces in {{project}}',
              {
                project: label
              }
            )
      }
      // Why in the indent gutter: the glyph stays aligned with projects that have no chevron.
      className="absolute inset-y-0 flex w-2.5 items-center justify-center text-muted-foreground hover:text-foreground"
      style={{ left: Math.max(0, paddingLeft - 10) }}
      onPointerDown={handleRepoHeaderCollapseAffordancePointerDown}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
    >
      <ChevronRight className={cn('size-2.5 transition-transform', open && 'rotate-90')} />
    </button>
  )
}

export function IdleProjectCountPill({ count }: { count: number }): React.JSX.Element {
  return (
    <Badge
      variant="secondary"
      data-idle-project-count=""
      aria-label={translate(
        'auto.components.sidebar.IdleProjectFold.count',
        '{{count}} workspaces',
        {
          count
        }
      )}
      className="h-4 rounded-full bg-muted-foreground/20 px-1.5 py-0 text-[10px] leading-none font-medium text-muted-foreground"
    >
      {count}
    </Badge>
  )
}
