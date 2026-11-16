import React from 'react'
import { ChevronRight } from 'lucide-react'
import type { VirtualItem } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { GroupHeaderRow } from '../grouping/row-types'
import { getVirtualRowTransform } from '../viewport/virtual-rows'
import { getProjectGroupHeaderPaddingLeft } from './indentation'
import { getWorktreeOptionId } from './option-dom'
import type { SectionHeaderRowContext } from './SectionHeader'

/** "En reposo · N proyectos": a collapsible label over the idle projects; it never pins. */
export function renderIdleProjectsGroupHeaderRow(args: {
  ctx: SectionHeaderRowContext
  row: GroupHeaderRow
  vItem: VirtualItem
  hasHeaderTopSpacing: boolean
  measureVirtualRowElement: (element: HTMLDivElement | null) => void
}): React.JSX.Element {
  const { ctx, row, vItem } = args
  // Why from the row: it was built from the effective collapse set, which a reveal or send picker can open.
  const collapsed = row.idleProjectsGroup?.collapsed === true
  const paddingLeft = getProjectGroupHeaderPaddingLeft(0)
  const toggle = (): void => ctx.toggleGroupWithScrollAnchor(row.key)
  return (
    <div
      key={vItem.key}
      role="presentation"
      data-worktree-virtual-row
      data-worktree-virtual-row-key={String(vItem.key)}
      data-worktree-virtual-row-start={vItem.start}
      data-index={vItem.index}
      ref={args.measureVirtualRowElement}
      className={cn('absolute top-0 left-0 right-0', args.hasHeaderTopSpacing && 'pt-1')}
      style={{ transform: getVirtualRowTransform(vItem.start) }}
    >
      <div
        id={getWorktreeOptionId(row.key)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        data-idle-projects-group={collapsed ? 'collapsed' : 'open'}
        className={cn(
          'relative flex h-7 w-full cursor-pointer items-center gap-1.5 overflow-hidden pr-2 text-left text-[11.5px] text-muted-foreground hover:text-foreground',
          ctx.highlightedRevealRowKey === row.key &&
            'rounded-md bg-worktree-sidebar-accent ring-1 ring-worktree-sidebar-ring/50'
        )}
        style={{ paddingLeft }}
        onClick={toggle}
        onKeyDown={(event) => {
          const opens = event.key === 'ArrowRight' && collapsed
          const closes = event.key === 'ArrowLeft' && !collapsed
          if (event.key === 'Enter' || event.key === ' ' || opens || closes) {
            event.preventDefault()
            // Why: the list's Enter hands focus to the terminal; a header toggle keeps it here.
            event.stopPropagation()
            toggle()
          }
        }}
      >
        {/* Why in the indent gutter: the label lines up with the project glyphs below, as drawn. */}
        <ChevronRight
          aria-hidden
          className={cn('absolute size-2.5 transition-transform', !collapsed && 'rotate-90')}
          style={{ left: Math.max(0, paddingLeft - 10) }}
        />
        <span className="truncate">{row.label}</span>
        <span data-idle-projects-count="" className="shrink-0 tabular-nums">
          {translate('auto.components.sidebar.IdleProjectsGroup.count', '{{count}} projects', {
            count: row.count
          })}
        </span>
      </div>
    </div>
  )
}
