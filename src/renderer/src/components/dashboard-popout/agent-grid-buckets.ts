import type { AgentDotState } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { dashboardBucketLabel } from '../dashboard/dashboard-bucket-label'
import type { DashboardBucket } from '../../../../shared/dashboard-snapshot'

/**
 * The grid's bucket for a cell, from the cell's own dot state.
 *
 * Why not `card.bucket`: that one is derived in the store, while the cell's dot
 * comes from the session log. Reading the count from one and the word from the
 * other let a cell say Working while the strip counted it under Needs You
 * (ORCA-234). One source, and the cell keeps the precise word.
 */
export function agentGridBucketForDotState(
  state: AgentDotState,
  unseen: boolean
): DashboardBucket {
  // The board's own rule: a finished agent you have already seen is idle, not a
  // result waiting to be read. Dropping it made the strip's counts stop adding
  // up to the agents on screen.
  if (state === 'done' && !unseen) {
    return 'idle'
  }
  switch (state) {
    case 'working':
      return 'working'
    case 'done':
    case 'failed':
      return 'done'
    case 'idle':
      return 'idle'
    case 'blocked':
    case 'waiting':
    case 'interrupted':
    case 'permission':
      return 'attention'
  }
}

/** Dot state the cell shows: the board's seen rule, applied once. */
export function agentGridDisplayDotState(state: AgentDotState, unseen: boolean): AgentDotState {
  return state === 'done' && !unseen ? 'idle' : state
}

/**
 * The word a cell shows for its state, translated.
 *
 * Why not `agentStateLabel`: that one is the accessible label and returns raw
 * English, so a Spanish window read "Idle" beside a strip that said Inactivo.
 * The three bucket-shaped states reuse the strip's own keys, so the two can
 * never drift apart again (ORCA-234).
 */
export function agentGridStateLabel(state: AgentDotState, unseen: boolean): string {
  const display = agentGridDisplayDotState(state, unseen)
  switch (display) {
    case 'working':
      return dashboardBucketLabel('working')
    case 'done':
      return dashboardBucketLabel('done')
    case 'idle':
      return dashboardBucketLabel('idle')
    case 'blocked':
      return translate('dashboardPopout.state.blocked', 'Blocked')
    case 'waiting':
    case 'permission':
      return translate('dashboardPopout.state.waiting', 'Waiting for input')
    case 'interrupted':
      return translate('dashboardPopout.state.interrupted', 'Interrupted')
    case 'failed':
      return translate('dashboardPopout.state.failed', 'Failed')
  }
}
