import React from 'react'
import { WorktreeLineageChildChip } from './worktree-lineage-child-chip'
import type { WorktreeCardController } from './use-worktree-card-controller'

/** A card's child workspaces and their show/hide control; the new card style's surface draws the children. */
export function WorktreeCardLineageChildren({
  card
}: {
  card: WorktreeCardController
}): React.JSX.Element {
  const {
    newCardStyle,
    lineageChildren,
    lineageCollapsed,
    onLineageToggle,
    showLineageChildChip,
    lineageChildAriaLabel,
    childWorkspaceShortLabel
  } = card
  return (
    <>
      {showLineageChildChip && (
        <WorktreeLineageChildChip
          newCardStyle={newCardStyle}
          collapsed={lineageCollapsed}
          ariaLabel={lineageChildAriaLabel}
          shortLabel={childWorkspaceShortLabel}
          onToggle={onLineageToggle}
        />
      )}

      {!newCardStyle && lineageChildren && (
        <div className="-ml-[1.125rem] mt-1.5 w-[calc(100%+1.125rem)] space-y-1">
          {lineageChildren}
        </div>
      )}
    </>
  )
}
