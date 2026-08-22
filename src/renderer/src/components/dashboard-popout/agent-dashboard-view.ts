import {
  AGENT_DASHBOARD_POPOUT_VIEWS,
  type AgentDashboardPopoutView
} from '../../../../shared/dashboard-snapshot'

export type AgentDashboardView = AgentDashboardPopoutView

/** Maps the free-form `popout.html?view=` string onto a real view. */
export function resolveAgentDashboardView(
  requested: string | null | undefined,
  fallback: AgentDashboardView
): AgentDashboardView {
  if (requested === 'rings') {
    return 'map'
  }
  return AGENT_DASHBOARD_POPOUT_VIEWS.find((view) => view === requested) ?? fallback
}
