import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNow } from '@/components/dashboard/useNow'
import {
  deliveredPrKindOf,
  deliveredPrOf,
  groupDeliveredRows,
  type DeliveredMember
} from './sidebar-delivered-members'
import { toggleDeliveredFlag, useSidebarDeliveredStore } from './sidebar-delivered-store'
import { deliveredFoldedCount, deliveredGroupLabel } from './sidebar-delivered-words'

type DeliveredChild = DeliveredMember & { node: React.ReactNode }

const NO_QUEUE: ReadonlySet<number> = new Set()

/**
 * The lead's lineage children split into live ones and freed ones, by the worktree id each row
 * element carries (renderWorktreeItemRow's `data-worktree-id`), keeping the list's own order.
 */
export function splitTeamChildren(
  children: React.ReactNode,
  delivered: Readonly<Record<string, DeliveredMember>>
): { live: React.ReactNode[]; freed: DeliveredChild[] } {
  const live: React.ReactNode[] = []
  const freed: DeliveredChild[] = []
  for (const node of React.Children.toArray(children)) {
    const props = React.isValidElement<Record<string, unknown>>(node) ? node.props : null
    const id = typeof props?.['data-worktree-id'] === 'string' ? props['data-worktree-id'] : null
    const member = id ? delivered[id] : undefined
    if (member) {
      freed.push({ ...member, node })
    } else {
      live.push(node)
    }
  }
  return { live, freed }
}

// Why stop both: the group sits inside the lead's card, whose click opens the lead and whose
// pointer-down starts a drag.
const stop = (event: React.SyntheticEvent): void => event.stopPropagation()

const TOGGLE_CLASS =
  'flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md pl-[9px] text-left text-[11.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring'

/** Delivered · N, folded rows counted, under the live members; rows past 24 h fold into one count row. */
export function SidebarDeliveredGroup({
  leadWorktreeId,
  rows
}: {
  leadWorktreeId: string
  rows: readonly DeliveredChild[]
}): React.JSX.Element {
  const kinds = useSidebarDeliveredStore((s) => s.prKindByWorktreeId)
  const collapsed = useSidebarDeliveredStore((s) => s.collapsedByLead[leadWorktreeId] === true)
  const foldedOpen = useSidebarDeliveredStore((s) => s.foldedOpenByLead[leadWorktreeId] === true)
  const now = useNow(30_000)
  // Why the recorded PR first: a card publishes its own read only after it mounts.
  const kindOf = (worktreeId: string) => {
    const recorded = rows.find((row) => row.worktreeId === worktreeId)?.recordedPr ?? null
    return kinds[worktreeId] ?? deliveredPrKindOf(deliveredPrOf(null, recorded, NO_QUEUE))
  }
  const { recent, folded } = groupDeliveredRows(rows, kindOf, now)
  const Chevron = (open: boolean) => (open ? ChevronDown : ChevronRight)
  const HeaderChevron = Chevron(!collapsed)
  const FoldedChevron = Chevron(foldedOpen)
  return (
    <div data-sidebar-delivered-group="" className="mt-1">
      <button
        type="button"
        data-sidebar-delivered-header=""
        aria-expanded={!collapsed}
        className={TOGGLE_CLASS}
        onPointerDown={stop}
        onDoubleClick={stop}
        onClick={(event) => {
          stop(event)
          toggleDeliveredFlag('collapsedByLead', leadWorktreeId)
        }}
      >
        <HeaderChevron className="size-3 shrink-0" aria-hidden="true" />
        <span data-delivered-label="">{deliveredGroupLabel()}</span>
        <span data-delivered-count="" className="ml-1 tabular-nums">
          {rows.length}
        </span>
      </button>
      {/* Why hidden, not unmounted: each card reads its own PR, and a folded CI failure must surface.
          Why one keyed list: a row crossing the fold moves without remounting its card. */}
      <div data-sidebar-delivered-body="" hidden={collapsed}>
        {recent.map((row) => (
          <div key={row.worktreeId} data-delivered-slot="recent">
            {row.node}
          </div>
        ))}
        {folded.length > 0 ? (
          <button
            key="folded-toggle"
            type="button"
            data-sidebar-delivered-folded-toggle=""
            aria-expanded={foldedOpen}
            className={cn(TOGGLE_CLASS, 'pl-[11px]')}
            onPointerDown={stop}
            onDoubleClick={stop}
            onClick={(event) => {
              stop(event)
              toggleDeliveredFlag('foldedOpenByLead', leadWorktreeId)
            }}
          >
            <FoldedChevron className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{deliveredFoldedCount(folded.length)}</span>
          </button>
        ) : null}
        {folded.map((row) => (
          <div
            key={row.worktreeId}
            data-delivered-slot="folded"
            data-delivered-muted=""
            hidden={!foldedOpen}
            className="opacity-70"
          >
            {row.node}
          </div>
        ))}
      </div>
    </div>
  )
}
