import type { TeamTodoTicket } from './team-panel-model-types'

function shellWord(value: string): string {
  return /^[\w.@:-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

/** What Add a member sends the lead: the project's work-on prompt and the launch it asks for (ORCA-717). */
export function addMemberPromptOf(
  ticket: TeamTodoTicket,
  accountId: string | null,
  host: string | null = null
): string {
  const account = accountId ? ` --account ${accountId}` : ''
  const on = host ? ` --on ${shellWord(host)}` : ''
  return `${ticket.prompt}\n\nLaunch its member with: orca game launch ${ticket.identifier}${account}${on}`
}
