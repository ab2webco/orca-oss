import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import type { GameHistoryAdoption } from '../../shared/orchestrator-game-log-adoption'

export function formatGameHistoryAdoption(result: GameHistoryAdoption): string {
  const { history, lessons, stop } = result
  if (!history && lessons === null && !stop) {
    return `Nothing to adopt: ${result.from} holds no game data on this host.`
  }
  return [
    `Adopted ${result.from} into ${result.to}:`,
    `  history  ${history ? `${history.records} records, ${history.events} events` : 'none'}`,
    `  lessons  ${lessons ?? 'none'}`,
    `  STOP     ${stop ? `set since ${stop.since}` : 'none'}`,
    'Not carried: saved members, the lead conversation and drops (they name the old worktrees).'
  ].join('\n')
}

export const ORCHESTRATOR_GAME_ADOPT_HISTORY_HANDLERS: Record<string, CommandHandler> = {
  'game adopt-history': async ({ flags, client, json }) => {
    const raw = flags.get('from-repo-id')
    const fromRepoId = typeof raw === 'string' ? raw.trim() : ''
    if (!fromRepoId) {
      throw new RuntimeClientError('invalid_argument', '--from-repo-id <id> is required.')
    }
    try {
      const response = await client.call<GameHistoryAdoption>('game.adoptHistory', {
        worktreeId: process.env.ORCA_WORKTREE_ID,
        terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
        fromRepoId
      })
      printResult(response, json, formatGameHistoryAdoption)
    } catch (error) {
      if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
        throw new RuntimeClientError(
          'incompatible_runtime',
          'The connected Orca Lab cannot adopt game history yet. Update or restart Orca Lab.'
        )
      }
      throw error
    }
  }
}
