import type { GameRole } from '../types'

// Why: Task is the subagent tool's older name, still sent by some builds and plugins.
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])
const PLAIN_WORD = /^[A-Za-z0-9_./:@%+=,-]+$/

const cliWordOf = (cli: string): string =>
  PLAIN_WORD.test(cli) ? cli : `'${cli.replaceAll("'", "'\\''")}'`

/** The refusal for a lead's Agent or Task call, or null to let the call run. */
export function leadSubagentDenyOf(args: {
  role: GameRole | undefined
  tool: string
  cli: string
}): string | null {
  if (args.role !== 'lead' || !SUBAGENT_TOOLS.has(args.tool)) {
    return null
  }
  const launch = `${cliWordOf(args.cli)} game launch <ticket>`
  return `Orca game lead: ${args.tool} subagents are refused here. Launch a member instead: ${launch}, or --prompt "<task>" for work that is not a ticket.`
}
