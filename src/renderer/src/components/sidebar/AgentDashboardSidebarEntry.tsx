import { LayoutDashboard } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { StatusDot } from '@/components/StatusDot'
import type { DashboardBucket } from '../../../../shared/dashboard-snapshot'
import { useAgentBucketCounts } from '@/components/dashboard/useAgentBucketCounts'
import { translate } from '@/i18n/i18n'

function NavCount({
  label,
  count,
  children
}: {
  label: string
  count: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      aria-label={`${label}: ${count}`}
      className="inline-flex items-center gap-1 text-[10px] tabular-nums text-worktree-sidebar-foreground/55"
    >
      {children}
      {count}
    </span>
  )
}

/** V30's drawNav: who needs you, when anyone does, and how many are working, even none. */
function DashboardNavCounts({
  counts
}: {
  counts: Record<DashboardBucket, number>
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      {counts.attention > 0 ? (
        <NavCount
          label={translate('dashboardPopout.bucket.attention', 'Needs You')}
          count={counts.attention}
        >
          <StatusDot tone="attention" glyph="question" aria-hidden="true" />
        </NavCount>
      ) : null}
      <NavCount
        label={translate('dashboardPopout.bucket.working', 'Working')}
        count={counts.working}
      >
        <StatusDot tone="info" glyph="spinner" aria-hidden="true" />
      </NavCount>
    </span>
  )
}

export default function AgentDashboardSidebarEntry(): React.JSX.Element {
  const dashboardBucketCounts = useAgentBucketCounts()
  const openAsPopout = useAppStore((s) => s.settings?.experimentalAgentDashboardMode === 'popout')
  const drawerOpen = useAppStore((s) => s.agentDashboardDrawerOpen)
  const setAgentDashboardDrawerOpen = useAppStore((s) => s.setAgentDashboardDrawerOpen)

  return (
    <button
      type="button"
      onClick={() => {
        if (openAsPopout) {
          void window.api.dashboard.openPopout()
        } else {
          setAgentDashboardDrawerOpen(!drawerOpen)
        }
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <LayoutDashboard
        className="size-4 shrink-0 text-worktree-sidebar-foreground/30"
        strokeWidth={1.75}
      />
      <span className="flex-1">{translate('dashboard.sidebar.label', 'Agent Dashboard')}</span>
      <DashboardNavCounts counts={dashboardBucketCounts} />
    </button>
  )
}
