import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import type { GameMemberSession } from '../../shared/orchestrator-game-member-sessions'
import type { RuntimeTerminalSleepingOwner } from '../../shared/runtime-types'

/** The game member a slept pane belongs to: its own conversation first, else its worktree (ORCA-915). */
export function sleepingTerminalOwnerOf(args: {
  record: SleepingAgentSessionRecord
  members: readonly GameMemberSession[]
  leadOfRun: (runId: string) => string | null
  pinnedAccount: string | null
}): RuntimeTerminalSleepingOwner | null {
  const { record, members } = args
  const member =
    members.find((one) => one.sessionId !== null && one.sessionId === record.providerSession.id) ??
    members.find((one) => one.worktreeId === record.worktreeId && one.lastState !== 'finished')
  if (!member) {
    return null
  }
  return {
    lead: args.leadOfRun(member.runId),
    ticket: member.ticket,
    account: member.account ?? args.pinnedAccount
  }
}
