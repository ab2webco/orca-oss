import React from 'react'
import { AgentIcon } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { InlineUsageBars } from '../status-bar/StatusBar'
import type { SidebarUsageEntry } from './sidebar-project-usage-model'

/**
 * Compact per-project usage line for the sidebar, sitting under a project's
 * worktrees. Reuses the status bar's InlineUsageBars so the numbers and colors
 * match the Usage popover exactly; renders nothing when there is no usage to
 * show, so the virtualizer collapses the row to ~0 height.
 */
export const SidebarProjectUsageIndicator = React.memo(function SidebarProjectUsageIndicator({
  entries
}: {
  entries: readonly SidebarUsageEntry[]
}): React.JSX.Element | null {
  if (entries.length === 0) {
    return null
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-1 pl-6 pr-2">
      {entries.map((entry) => (
        <div key={entry.provider} className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 opacity-70">
            <AgentIcon agent={entry.provider} size={12} />
          </span>
          {entry.limits ? (
            <InlineUsageBars limits={entry.limits} isFetching={entry.isFetching} />
          ) : (
            <span className="truncate text-[10px] text-muted-foreground">
              {entry.isFetching
                ? translate('auto.components.sidebar.projectUsage.loading', 'Loading usage…')
                : translate('auto.components.sidebar.projectUsage.pending', 'Usage not loaded yet')}
            </span>
          )}
        </div>
      ))}
    </div>
  )
})
