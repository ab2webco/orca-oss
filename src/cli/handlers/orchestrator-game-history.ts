import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'

export type GameHistoryResult = { records: GameHistoryRecord[] }

function optionalText(flags: Map<string, string | boolean>, name: string): string | undefined {
  const raw = flags.get(name)
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

export function formatGameHistory(history: GameHistoryResult): string {
  if (history.records.length === 0) {
    return 'No members in the history yet.'
  }
  return history.records
    .map((one) => {
      const who = [one.agent, one.account].filter(Boolean).join(' · ')
      const where = [one.repo, one.branch ? `⎇ ${one.branch}` : null].filter(Boolean).join(' ')
      const head = `${one.endedAt} ${one.ticket ?? '?'} ${one.outcome}${one.pr ? ` ${one.pr}` : ''}${who ? ` · ${who}` : ''}${where ? ` · ${where}` : ''}`
      return one.lastReport ? `${head}\n  ${one.lastReport.replace(/\s+/g, ' ')}` : head
    })
    .join('\n')
}

export const ORCHESTRATOR_GAME_HISTORY_HANDLERS: Record<string, CommandHandler> = {
  'game history': async ({ flags, client, json }) => {
    const ticket = optionalText(flags, 'ticket')?.toUpperCase()
    const since = optionalText(flags, 'since')
    if (since !== undefined && Number.isNaN(Date.parse(since))) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--since must be a date like 2026-10-15 or 2026-10-15T09:00, not "${since}".`
      )
    }
    try {
      const response = await client.call<GameHistoryResult>('game.history', {
        worktreeId: process.env.ORCA_WORKTREE_ID,
        terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
        ...(ticket ? { ticket } : {}),
        ...(since ? { since } : {})
      })
      printResult(response, json, formatGameHistory)
    } catch (error) {
      if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
        throw new RuntimeClientError(
          'incompatible_runtime',
          'The connected Orca Lab does not keep game history yet. Update or restart Orca Lab.'
        )
      }
      throw error
    }
  }
}
