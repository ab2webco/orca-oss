import type { GamePausedMember } from '../../shared/orchestrator-game-member-sessions'

const causeText = (member: Pick<GamePausedMember, 'cause' | 'terminal'>): string => {
  switch (member.cause) {
    case 'terminal-open':
      return `its terminal ${member.terminal ?? ''} is open but not reporting`
    case 'unsubmitted':
      return `its brief was never submitted in ${member.terminal ?? 'its terminal'}`
    default:
      // Why both: a gone terminal reads the same after a restart and after the agent exited.
      return 'its terminal is gone (it ended or Orca restarted)'
  }
}

/** Why `game launch` refuses a paused ticket, named by its real cause. */
export const gamePausedRefusalOf = (
  member: Pick<GamePausedMember, 'ticket' | 'cause' | 'terminal'>
): string =>
  `${member.ticket} is paused, ${causeText(member)}: \`orca game resume-members ${member.ticket}\` resumes it, \`orca game resume-members ${member.ticket} --discard\` frees it.`
