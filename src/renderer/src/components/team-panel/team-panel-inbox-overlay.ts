import type { TeamInboxCounts, TeamSection } from '../../../../shared/team-panel-model-types'

/**
 * This project's Inbox counts plus its questions the model cannot see. Other projects' questions
 * never count; they only keep the tab readable when this project's own read failed.
 */
export function withAddedInboxQuestions(
  own: TeamSection<TeamInboxCounts>,
  added: number,
  otherOpen: number
): TeamSection<TeamInboxCounts> {
  if (own.kind === 'loading') {
    return own
  }
  if (own.kind === 'ready') {
    return added === 0
      ? own
      : { kind: 'ready', value: { ...own.value, forYou: own.value.forYou + added } }
  }
  if (added + otherOpen === 0) {
    return own
  }
  return {
    kind: 'ready',
    value: {
      forYou: added,
      waiting: 0,
      threads: 0,
      answered: 0,
      projectUnread: { message: own.kind === 'error' ? own.message : null }
    }
  }
}
