import React from 'react'
import { translate } from '@/i18n/i18n'
import type { HiddenByFiltersBreakdown } from './sidebar-filter-hidden-count'
import type { SidebarHidingFilter } from './sidebar-hiding-filters'

type SidebarHiddenFiltersLineProps = {
  breakdown: HiddenByFiltersBreakdown
  revealed: boolean
  onToggleReveal: () => void
}

function hiddenFilterLabel(filter: SidebarHidingFilter, count: number): string {
  switch (filter) {
    case 'other-device':
      return translate(
        'auto.components.sidebar.SidebarHiddenFiltersLine.otherDevice',
        '{{count}} from other devices',
        { count }
      )
    case 'default-branch':
      return translate(
        'auto.components.sidebar.SidebarHiddenFiltersLine.defaultBranch',
        '{{count}} default branch',
        { count }
      )
    case 'automation':
      return translate(
        'auto.components.sidebar.SidebarHiddenFiltersLine.automationCreated',
        '{{count}} automation-created',
        { count }
      )
    case 'cli':
      return translate(
        'auto.components.sidebar.SidebarHiddenFiltersLine.cliCreated',
        '{{count}} CLI-created',
        { count }
      )
    case 'detached-head':
      return translate(
        'auto.components.sidebar.SidebarHiddenFiltersLine.detachedHead',
        '{{count}} detached HEAD',
        { count }
      )
    case 'host':
      return translate(
        'auto.components.sidebar.SidebarHiddenFiltersLine.otherHost',
        '{{count}} on other hosts',
        { count }
      )
    case 'project':
      return translate(
        'auto.components.sidebar.SidebarHiddenFiltersLine.otherProject',
        '{{count}} in other projects',
        { count }
      )
    case 'sleeping':
      return translate(
        'auto.components.sidebar.SidebarHiddenFiltersLine.sleeping',
        '{{count}} sleeping',
        { count }
      )
  }
}

// Names each filter hiding rows, and reveals those rows inline (dimmed) until hidden again.
export function SidebarHiddenFiltersLine({
  breakdown,
  revealed,
  onToggleReveal
}: SidebarHiddenFiltersLineProps): React.JSX.Element | null {
  if (breakdown.total <= 0) {
    return null
  }
  // Why: largest reason first reads as the answer to "why is my list short"; sort is stable on ties.
  const counts = [...breakdown.counts].sort((a, b) => b.count - a.count)
  return (
    <div
      data-sidebar-hidden-by-filters={breakdown.total}
      data-sidebar-hidden-revealed={revealed ? 'true' : 'false'}
      className="flex shrink-0 flex-wrap items-baseline gap-x-1 px-3 py-1.5 text-[11px] text-muted-foreground"
    >
      <span>
        {translate('auto.components.sidebar.SidebarHiddenFiltersLine.total', '{{count}} hidden:', {
          count: breakdown.total
        })}
      </span>
      {/* Why one nowrap span per filter: a narrow sidebar wraps between filters, never inside "CLI-created". */}
      {counts.map((entry, index) => (
        <React.Fragment key={entry.filter}>
          {' '}
          <span className="whitespace-nowrap">
            {hiddenFilterLabel(entry.filter, entry.count)}
            {index < counts.length - 1 ? ' ·' : ''}
          </span>
        </React.Fragment>
      ))}{' '}
      <button
        type="button"
        aria-pressed={revealed}
        onClick={onToggleReveal}
        className="whitespace-nowrap pl-0.5 text-foreground underline underline-offset-2 hover:text-foreground/80"
      >
        {revealed
          ? translate('auto.components.sidebar.SidebarHiddenFiltersLine.hide', 'Hide')
          : translate('auto.components.sidebar.SidebarHiddenFiltersLine.show', 'Show')}
      </button>
    </div>
  )
}
