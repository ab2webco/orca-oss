import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

type GameLeadsResult = {
  leads: { project: string; label: string; handle: string; since: string }[]
}

const UNSUPPORTED = 'This Orca host does not support game leads. Update or restart Orca Lab.'

function formatGameLeads({ leads }: GameLeadsResult): string {
  if (leads.length === 0) {
    return 'No lead is live on this Orca host.'
  }
  const own = process.env.ORCA_TERMINAL_HANDLE
  const rows = leads.map((one) => [
    one.project,
    one.label || '-',
    one.handle,
    one.handle === own ? 'live (you)' : 'live'
  ])
  const widths = [0, 1, 2].map((column) =>
    Math.max(
      'project label lead'.split(' ')[column]?.length ?? 0,
      ...rows.map((row) => row[column]?.length ?? 0)
    )
  )
  const line = (cells: string[]): string =>
    cells.map((cell, column) => (column < 3 ? cell.padEnd(widths[column] ?? 0) : cell)).join('  ')
  return [line(['project', 'label', 'lead', 'state']), ...rows.map(line)].join('\n')
}

export const ORCHESTRATOR_GAME_LEADS_HANDLERS: Record<string, CommandHandler> = {
  'game leads': async ({ client, json }) => {
    try {
      printResult(await client.call<GameLeadsResult>('game.leads'), json, formatGameLeads)
    } catch (error) {
      if (!(error instanceof RuntimeClientError) || error.code !== 'method_not_found') {
        throw error
      }
      // Why not a throw: an older host is a state to report, and a lead reads this output.
      console.log(
        json ? JSON.stringify({ ok: true, result: { leads: [], supported: false } }) : UNSUPPORTED
      )
    }
  }
}
