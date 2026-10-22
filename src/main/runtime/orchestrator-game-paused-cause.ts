import type { GamePausedCause } from '../../shared/orchestrator-game-member-sessions'
import type { DispatchContextRow } from './orchestration/types'

type DispatchFacts = Pick<
  DispatchContextRow,
  'status' | 'assignee_handle' | 'first_lifecycle_signal_at' | 'turn_accepted_at'
>

/**
 * Why a saved member is not live while its terminal is still open (ORCA-754). Null when the
 * terminal is gone, the only case the restart wording is true for.
 */
export function gamePausedCauseOf(
  dispatch: DispatchFacts | undefined,
  isTerminalOpen: (handle: string) => boolean
): { cause: GamePausedCause; terminal: string } | null {
  const terminal = dispatch?.assignee_handle
  if (!terminal || !isTerminalOpen(terminal)) {
    return null
  }
  const unsubmitted =
    dispatch.status === 'dispatched' &&
    dispatch.first_lifecycle_signal_at === null &&
    dispatch.turn_accepted_at === null
  return { cause: unsubmitted ? 'unsubmitted' : 'terminal-open', terminal }
}
