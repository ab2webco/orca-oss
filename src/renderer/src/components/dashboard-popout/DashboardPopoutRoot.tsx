import { useEffect, useState } from 'react'
import { AgentKanbanBoard } from './AgentKanbanBoard'
import { resolveAgentDashboardView, type AgentDashboardView } from './agent-dashboard-view'
import { useDashboardSnapshot } from './useDashboardSnapshot'

type DashboardPopoutRootProps = {
  /** The layout requested via popout.html?view=<name>. */
  view: string | null
}

/**
 * Root of the pop-out dashboard window. Subscribes to the live snapshot relayed
 * from the main window and renders the requested layout.
 */
export function DashboardPopoutRoot(_props: DashboardPopoutRootProps): React.JSX.Element {
  const snapshot = useDashboardSnapshot()
  // The consolidated grid is the pop-out's default: it is the only view that
  // answers "what are they all doing" without opening anything (ORCA-234).
  const [view, setView] = useState<AgentDashboardView>(() =>
    resolveAgentDashboardView(_props.view, 'grid')
  )
  useEffect(
    () =>
      window.api.dashboard.onViewRequested((next) =>
        setView(resolveAgentDashboardView(next, 'grid'))
      ),
    []
  )
  return <AgentKanbanBoard key={view} snapshot={snapshot} initialView={view} />
}
