import { agentStateLabel, type AgentDotState } from '@/components/AgentStateDot'
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

/**
 * The word a cell shows for its state.
 *
 * Why not the raw dot state: the strip counts a finished-and-seen agent as
 * idle, so the cell calling it Done was the same two-vocabulary mismatch one
 * level down. Precision is kept everywhere else — a failed agent still says
 * Failed rather than its bucket (ORCA-234).
 */
export function agentGridStateLabel(state: AgentDotState, unseen: boolean): string {
  return agentStateLabel(state === 'done' && !unseen ? 'idle' : state)
}
