import { formatSetupQueue, type GameSetupQueue } from './orchestrator-game-setup-queue'

export type GameResumedMember = {
  ticket: string
  result:
    | 'resumed'
    | 'relaunched'
    | 'submitted'
    | 'woken'
    | 'finished'
    | 'skipped'
    | 'unresumable'
    | 'failed'
  dispatchId?: string
  /** The open terminal Enter was pressed in, for `submitted`. */
  terminal?: string
  setupQueue?: GameSetupQueue
  reason?: string
  note?: string
}

const RESULT_TEXT: Record<GameResumedMember['result'], string> = {
  resumed: 'its conversation reopened',
  relaunched: 'a new agent started on its task',
  submitted: 'Enter pressed in its terminal',
  woken: 'its pane woke',
  finished: 'already finished, forgotten',
  skipped: 'skipped',
  unresumable: 'cannot resume',
  failed: 'failed'
}

export const formatResumedMembers = (result: { members: GameResumedMember[] }): string =>
  result.members.length === 0
    ? 'No paused members.'
    : result.members
        .map(
          (one) =>
            `${one.ticket}: ${RESULT_TEXT[one.result]}${one.terminal ? ` (${one.terminal})` : ''}${one.dispatchId ? ` (member ${one.dispatchId})` : ''}${one.setupQueue ? ` (${formatSetupQueue(one.setupQueue)})` : ''}${one.reason ? `: ${one.reason}` : ''}${one.note ? ` (${one.note})` : ''}`
        )
        .join('\n')
