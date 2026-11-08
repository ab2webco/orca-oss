import type { OrchestratorGameState } from './orchestrator-game-state'
import type { TeamMetrics, TeamSection } from './team-panel-model-types'

/**
 * Display's figures from the metrics game.state publishes. Hourly merges, CI history, flaky checks
 * and cost have no source in Orca yet, so they stay null and the page says so.
 */
export function teamMetricsOf(state: OrchestratorGameState): TeamSection<TeamMetrics> {
  const metrics = state.metrics
  if (!metrics) {
    return { kind: 'unavailable' }
  }
  return {
    kind: 'ready',
    value: {
      timezone: metrics.timezone,
      mergedPerDay: metrics.mergedPerDay,
      mergedPerHour24h: null,
      leadTimeMedianMs: metrics.leadTime.medianMs,
      ciGreenPercent: null,
      ciGreenPerDay: null,
      flakyChecks: null,
      accounts: (metrics.claudeAccounts ?? []).map((one) => ({
        email: one.email,
        sessionPercent: one.sessionPercent,
        weeklyPercent: one.weeklyPercent
      })),
      costPerDay: null
    }
  }
}
