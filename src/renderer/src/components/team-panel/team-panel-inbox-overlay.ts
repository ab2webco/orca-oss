import type { TeamInboxCounts, TeamSection } from '../../../../shared/team-panel-model-types'

/**
 * This project's Inbox counts plus every other project's and host's open questions, so the one
 * count on the tab bar covers them all.
 */
export function withOtherProjectQuestions(
  own: TeamSection<TeamInboxCounts>,
  otherOpen: number
): TeamSection<TeamInboxCounts> {
  if (otherOpen === 0 || own.kind === 'loading') {
    return own
  }
  if (own.kind === 'ready') {
    return { kind: 'ready', value: { ...own.value, forYou: own.value.forYou + otherOpen } }
  }
  return {
    kind: 'ready',
    value: {
      forYou: otherOpen,
      waiting: 0,
      threads: 0,
      answered: 0,
      projectUnread: { message: own.kind === 'error' ? own.message : null }
    }
  }
}
