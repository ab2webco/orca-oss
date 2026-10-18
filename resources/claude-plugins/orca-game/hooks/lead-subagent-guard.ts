import type { GameRole } from '../types'

// Why: Task is the subagent tool's older name, still sent by some builds and plugins.
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])
const TEAMMATE_KEYS = ['team_name', 'name'] as const
const PLAIN_WORD = /^[A-Za-z0-9_./:@%+=,-]+$/

const cliWordOf = (cli: string): string =>
  PLAIN_WORD.test(cli) ? cli : `'${cli.replaceAll("'", "'\\''")}'`

export const isSubagentTool = (tool: string): boolean => SUBAGENT_TOOLS.has(tool)

// Why: a teammate is addressed by its name, and a plain subagent call names none.
export function isTeammateSpawnOf(call: object): boolean {
  return TEAMMATE_KEYS.some((key) => {
    const value: unknown = Reflect.get(call, key)
    return typeof value === 'string' && value.trim() !== ''
  })
}

/** The refusal for an orchestrator lead's plain Agent or Task call, or null to let it run. */
export function leadSubagentDenyOf(args: {
  role: GameRole | undefined
  isOrchestrator: boolean
  tool: string
  isTeammateSpawn: boolean
  cli: string
}): string | null {
  if (
    args.role !== 'lead' ||
    !args.isOrchestrator ||
    args.isTeammateSpawn ||
    !isSubagentTool(args.tool)
  ) {
    return null
  }
  const launch = `${cliWordOf(args.cli)} game launch <ticket>`
  return `Orca game lead: ${args.tool} subagents are refused here. Launch a member instead: ${launch}, or --prompt "<task>" for work that is not a ticket.`
}
