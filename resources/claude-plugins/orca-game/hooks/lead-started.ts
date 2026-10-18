import type { EngineInterface } from 'claude-code'

export const STARTED_KEY = 'lead-started-sessions'
// Why: the only Bash call the lead rules make, so a session that runs it is the lead.
const GAME_LEAD_COMMAND = /\bgame lead\b/

export const startedOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

export const hasStartedLead = (value: unknown, session: string): boolean =>
  startedOf(value).includes(session)

export const isGameLeadCommand = (command: unknown): boolean =>
  typeof command === 'string' && GAME_LEAD_COMMAND.test(command)

/** Whether this session ran the lead rules: autostart, the lead skill or `game lead`. */
export async function isLeadStarted($: EngineInterface): Promise<boolean> {
  return hasStartedLead(
    await $.store.get(STARTED_KEY).catch(() => undefined),
    await $.session.id()
  )
}
