import { memberNameOf } from './orchestrator-game-member-names'
import { ticketInText } from './orchestrator-game-ticket-id'

/** A worker's terminal tab: `name · ticket · host` for a game member, as V28 draws it (ORCA-1094). */
export function workerTabTitleOf(args: {
  displayName?: string
  taskId: string
  /** Where the member runs; left out where the creating side cannot name it. */
  host?: string
}): string {
  const name = memberNameOf(args.displayName)
  const ticket = ticketInText(args.displayName)
  if (name && ticket) {
    return [name, ticket, args.host].filter(Boolean).join(' · ')
  }
  return args.displayName?.trim() || `worker-${args.taskId}`
}
