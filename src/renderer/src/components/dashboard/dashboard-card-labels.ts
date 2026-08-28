import { DASHBOARD_MAX_LABEL_LENGTH } from '../../../../shared/dashboard-snapshot'
import type { DashboardAgentRow } from './useDashboardData'

export function rowTask(row: DashboardAgentRow): string {
  return (row.entry.orchestration?.taskTitle ?? '').trim() || (row.entry.prompt ?? '').trim()
}

export function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Why: these labels come from unbounded sources (`terminal rename`, OSC titles,
 *  display names). Over the validator's bound the card would be dropped. */
export function boundedLabel(value: string): string {
  return value.length > DASHBOARD_MAX_LABEL_LENGTH
    ? value.slice(0, DASHBOARD_MAX_LABEL_LENGTH)
    : value
}
