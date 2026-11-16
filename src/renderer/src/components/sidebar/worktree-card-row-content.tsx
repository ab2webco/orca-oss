import React from 'react'
import { useAppStore } from '@/store'
import { useNow } from '@/components/dashboard/useNow'
import { WorktreeCardParentContent } from './worktree-card-parent-content'
import type { WorktreeCardPresentation } from './worktree-card-presentation'
import type { WorktreeCardController } from './use-worktree-card-controller'
import {
  SidebarTeamChildContext,
  useSidebarTeamLook,
  useSidebarTeamRowSince,
  type SidebarTeamRow
} from './sidebar-team-roster'
import { SidebarTeamAgentRow } from './SidebarTeamAgentRow'
import { WorktreeLineageChildChip } from './worktree-lineage-child-chip'
import { SidebarDeliveredRow } from './SidebarDeliveredRow'
import { SidebarDeliveredGroup, splitTeamChildren } from './SidebarDeliveredGroup'
import { useSidebarDeliveredStore } from './sidebar-delivered-store'
import type { DeliveredView } from './use-sidebar-delivered-view'

/** The lead's or a member's card reads as V30's agent row, a freed member's as its delivery. */
export function WorktreeCardRowContent({
  card,
  row,
  child = false,
  delivered = null,
  presentation
}: {
  card: WorktreeCardController
  row: SidebarTeamRow | null
  child?: boolean
  delivered?: DeliveredView | null
  presentation: WorktreeCardPresentation
}): React.JSX.Element {
  if (row) {
    return <WorktreeCardTeamContent row={row} child={child} />
  }
  return delivered ? (
    <WorktreeCardDeliveredContent view={delivered} />
  ) : (
    <WorktreeCardParentContent card={card} presentation={presentation} />
  )
}

function WorktreeCardDeliveredContent({ view }: { view: DeliveredView }): React.JSX.Element {
  const now = useNow(30_000)
  return (
    <div className="flex w-full min-w-0 flex-col" data-worktree-card-team-content="">
      <SidebarDeliveredRow view={view} now={now} />
    </div>
  )
}

function WorktreeCardTeamContent({
  row,
  child
}: {
  row: SidebarTeamRow
  child: boolean
}): React.JSX.Element {
  const look = useSidebarTeamLook()
  const showPr = useAppStore((s) => s.worktreeCardProperties?.includes('pr') === true)
  const now = useNow(30_000)
  const since = useSidebarTeamRowSince(row)
  return (
    <div className="flex w-full min-w-0 flex-col" data-worktree-card-team-content="">
      <SidebarTeamAgentRow
        row={row}
        look={look}
        showPr={showPr}
        now={now}
        since={since}
        child={child}
      />
    </div>
  )
}

/** The lead's members, drawn by the card surface outside the lead's hover trigger. */
export function WorktreeCardTeamChildren({
  card
}: {
  card: WorktreeCardController
}): React.JSX.Element | null {
  const {
    newCardStyle,
    lineageChildren,
    lineageCollapsed,
    showLineageChildChip,
    lineageChildAriaLabel,
    childWorkspaceShortLabel,
    onLineageToggle
  } = card
  const delivered = useSidebarDeliveredStore((s) => s.delivered)
  const { live, freed } = splitTeamChildren(lineageChildren, delivered)
  return (
    <>
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
      {lineageChildren ? (
        <SidebarTeamChildContext.Provider value>
          {/* Why 3 px and no row inset: with each child's 1 px border and 8 px padding the row lands
              12 px in from the lead, V30's step; mt-px matches the 2 px of borders between children. */}
          <div
            data-sidebar-team-children=""
            className="mt-px ml-[3px] w-[calc(100%-3px)] [&>[role=option]]:pl-0!"
          >
            {live}
            {freed.length > 0 ? (
              <SidebarDeliveredGroup leadWorktreeId={card.worktree.id} rows={freed} />
            ) : null}
          </div>
        </SidebarTeamChildContext.Provider>
      ) : null}
    </>
  )
}
