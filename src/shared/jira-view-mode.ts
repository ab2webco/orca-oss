import type { JiraViewMode } from './types'

export function normalizeJiraViewMode(value: unknown): JiraViewMode {
  return value === 'list' ? 'list' : 'board'
}
