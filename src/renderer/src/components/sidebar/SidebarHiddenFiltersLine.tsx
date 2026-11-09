import React from 'react'
import { translate } from '@/i18n/i18n'

type SidebarHiddenFiltersLineProps = {
  count: number
  onShowFilters: () => void
}

// V30's "N hidden by filters · View filters" line under the worktree list.
export function SidebarHiddenFiltersLine({
  count,
  onShowFilters
}: SidebarHiddenFiltersLineProps): React.JSX.Element | null {
  if (count <= 0) {
    return null
  }
  return (
    <div
      data-sidebar-hidden-by-filters={count}
      className="flex shrink-0 flex-wrap items-center gap-x-1 px-3 py-1.5 text-[11px] text-muted-foreground"
    >
      <span>
        {translate(
          'auto.components.sidebar.SidebarHiddenFiltersLine.04e60bbc42',
          '{{count}} hidden by filters',
          { count }
        )}
      </span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onShowFilters}
        className="text-foreground underline underline-offset-2 hover:text-foreground/80"
      >
        {translate('auto.components.sidebar.SidebarHiddenFiltersLine.aec1ffd95a', 'View filters')}
      </button>
    </div>
  )
}
