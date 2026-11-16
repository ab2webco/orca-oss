import type { GameMemberSession } from './orchestrator-game-member-sessions'

/** A start the host holds until its setup slot frees (ORCA-746). */
export type GameSetupQueueEntry = { taskId: string; position: number; waitingOn: string }

/** A member whose start waits for the setup in flight: neither live nor paused. */
export type GameQueuedMember = {
  ticket: string
  name: string | null
  position: number
  waitingOn: string
}

export function queuedMembersOf(
  members: readonly GameMemberSession[],
  setupQueue: readonly GameSetupQueueEntry[]
): GameQueuedMember[] {
  return setupQueue.flatMap((entry) => {
    const member = members.find((one) => one.taskId === entry.taskId)
    return member
      ? [
          {
            ticket: member.ticket,
            name: member.name,
            position: entry.position,
            waitingOn: entry.waitingOn
          }
        ]
      : []
  })
}
