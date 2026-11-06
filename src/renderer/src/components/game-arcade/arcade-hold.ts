import type { AgentStatusEntry } from '../../../../shared/agent-status-types'

/** An agent blocked on a permission or waiting for an answer holds the run until the user replies. */
export function isSomeoneWaitingOnUser(
  entries: Readonly<Record<string, AgentStatusEntry>>
): boolean {
  return Object.values(entries).some((one) => one.state === 'blocked' || one.state === 'waiting')
}
