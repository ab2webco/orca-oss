import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { PlaneViewMode, RateLimitFailBackMode } from '../../../shared/worktree/types'
import { normalizeJiraViewMode } from '../../../shared/jira-view-mode'
import { normalizeLinearViewMode } from '../../../shared/linear-view-mode'

// Why: cross-IPC/hand-edited payloads; only a non-empty account-id string may persist, anything else means "failover off".
export function normalizeRateLimitFailoverAccountId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 512 ? trimmed : null
}

export function normalizePlaneViewMode(value: unknown): PlaneViewMode {
  // Why 'board' by default: with agents moving work in parallel, the kanban shows
  // the state of everything at a glance. 'list' stays one click away.
  return value === 'list' ? 'list' : 'board'
}

export function normalizeRateLimitFailBackMode(value: unknown): RateLimitFailBackMode {
  // Why 'auto' by default: the point of failing over is to keep working, so the
  // return trip should not wait on a toast the user may never see. 'notify' and
  // 'off' stay available for anyone who wants to approve each return.
  return value === 'off' || value === 'notify' ? value : 'auto'
}

type TaskViewAndFailoverSettings = Pick<
  GlobalSettings,
  | 'rateLimitFailoverAccountId'
  | 'planeViewMode'
  | 'linearViewMode'
  | 'jiraViewMode'
  | 'rateLimitFailBackMode'
>

export function normalizeTaskViewAndFailoverSettings(
  settings: Partial<GlobalSettings> | undefined
): TaskViewAndFailoverSettings {
  return {
    rateLimitFailoverAccountId: normalizeRateLimitFailoverAccountId(
      settings?.rateLimitFailoverAccountId
    ),
    planeViewMode: normalizePlaneViewMode(settings?.planeViewMode),
    linearViewMode: normalizeLinearViewMode(settings?.linearViewMode),
    jiraViewMode: normalizeJiraViewMode(settings?.jiraViewMode),
    rateLimitFailBackMode: normalizeRateLimitFailBackMode(settings?.rateLimitFailBackMode)
  }
}

export function sanitizeTaskViewAndFailoverSettingsUpdate(
  updates: Partial<GlobalSettings>,
  sanitizedUpdates: Partial<GlobalSettings>
): void {
  if ('autoSwitchRateLimitedAccounts' in updates) {
    sanitizedUpdates.autoSwitchRateLimitedAccounts = updates.autoSwitchRateLimitedAccounts === true
  }
  if ('rateLimitFailoverAccountId' in updates) {
    sanitizedUpdates.rateLimitFailoverAccountId = normalizeRateLimitFailoverAccountId(
      updates.rateLimitFailoverAccountId
    )
  }
  if ('linearViewMode' in updates) {
    sanitizedUpdates.linearViewMode = normalizeLinearViewMode(updates.linearViewMode)
  }
  if ('jiraViewMode' in updates) {
    sanitizedUpdates.jiraViewMode = normalizeJiraViewMode(updates.jiraViewMode)
  }
  if ('planeViewMode' in updates) {
    sanitizedUpdates.planeViewMode = normalizePlaneViewMode(updates.planeViewMode)
  }
  if ('rateLimitFailBackMode' in updates) {
    sanitizedUpdates.rateLimitFailBackMode = normalizeRateLimitFailBackMode(
      updates.rateLimitFailBackMode
    )
  }
  if ('showWorktreeAccountUsage' in updates) {
    // Why: default-on setting — coerce non-bool payloads back to the default.
    sanitizedUpdates.showWorktreeAccountUsage = updates.showWorktreeAccountUsage !== false
  }
}
