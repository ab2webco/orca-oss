import React from 'react'
import { useAppStore } from '@/store'
import { useNow } from '@/components/dashboard/useNow'
import { WorktreeCardParentContent } from './worktree-card-parent-content'
import type { WorktreeCardPresentation } from './worktree-card-presentation'
import type { WorktreeCardController } from './use-worktree-card-controller'
import { useSidebarTeamLook, useSidebarTeamRow, type SidebarTeamRow } from './sidebar-team-roster'
import { SidebarTeamAgentRow } from './SidebarTeamAgentRow'
import { WorktreeLineageChildChip } from './worktree-lineage-child-chip'

/** The lead's or a member's card reads as V30's agent row; every other card stays as it is. */
export function WorktreeCardRowContent({
  card,
  presentation
}: {
  card: WorktreeCardController
  presentation: WorktreeCardPresentation
}): React.JSX.Element {
  const row = useSidebarTeamRow(card.worktree.id)
  return row ? (
    <WorktreeCardTeamContent card={card} row={row} />
  ) : (
    <WorktreeCardParentContent card={card} presentation={presentation} />
  )
}

function WorktreeCardTeamContent({
  card,
  row
}: {
  card: WorktreeCardController
  row: SidebarTeamRow
}): React.JSX.Element {
  const look = useSidebarTeamLook()
  const showPr = useAppStore((s) => s.worktreeCardProperties?.includes('pr') === true)
  const now = useNow(30_000)
  const {
    newCardStyle,
    lineageChildren,
    lineageCollapsed,
    showLineageChildChip,
    lineageChildAriaLabel,
    childWorkspaceShortLabel,
    onLineageToggle
  } = card
  return (
    <div className="flex w-full min-w-0 flex-col" data-worktree-card-team-content="">
      <SidebarTeamAgentRow row={row} look={look} showPr={showPr} now={now} />
      {/* Why only collapsed: V30 lists members under the lead, so the control shows only to reopen them. */}
      {showLineageChildChip && lineageCollapsed ? (
        <WorktreeLineageChildChip
          newCardStyle={newCardStyle}
          collapsed={lineageCollapsed}
          ariaLabel={lineageChildAriaLabel}
          shortLabel={childWorkspaceShortLabel}
          onToggle={onLineageToggle}
        />
      ) : null}
      {!newCardStyle && lineageChildren ? (
        <div className="-ml-[1.125rem] mt-0.5 w-[calc(100%+1.125rem)] space-y-0.5">
          {lineageChildren}
        </div>
      ) : null}
    </div>
  )
}
