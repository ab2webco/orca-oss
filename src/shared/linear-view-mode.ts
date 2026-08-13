import type { LinearViewMode } from './types'

export function normalizeLinearViewMode(value: unknown): LinearViewMode {
  return value === 'list' ? 'list' : 'board'
}
