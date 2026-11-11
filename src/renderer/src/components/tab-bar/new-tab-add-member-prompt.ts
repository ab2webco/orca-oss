import type { TeamTodoTicket } from '../../../../shared/team-panel-model-types'

/** What Add a member sends the lead: the project's work-on prompt and the launch it asks for (ORCA-717). */
export function addMemberPromptOf(ticket: TeamTodoTicket, accountId: string | null): string {
  const account = accountId ? ` --account ${accountId}` : ''
  return `${ticket.prompt}\n\nLaunch its member with: orca game launch ${ticket.identifier}${account}`
}
