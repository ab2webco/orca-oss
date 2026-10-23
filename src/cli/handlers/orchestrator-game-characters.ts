import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  GAME_HISTORY_OUTCOMES,
  type GameHistoryOutcome
} from '../../shared/orchestrator-game-history'
import type { GameCharacterRow } from '../../shared/orchestrator-game-characters'

export type GameCharactersResult = { characters: GameCharacterRow[] }

function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

const counted = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

const outcomesText = (outcomes: Record<GameHistoryOutcome, number>): string =>
  GAME_HISTORY_OUTCOMES.filter((outcome) => outcomes[outcome] > 0)
    .map((outcome) => `${outcome} ${outcomes[outcome]}`)
    .join(', ')

function characterText(one: GameCharacterRow): string {
  const task = one.current ? `on ${one.current.ticket ?? 'a task'}` : 'free'
  const head = `${one.name}  Lv ${one.level.level} · ${one.xp} XP · ${task}`
  if (one.tickets === 0 && one.recent.length === 0) {
    return `${head}\n  no tasks yet`
  }
  const totals = [
    counted(one.tickets, 'ticket'),
    `${counted(one.prsOpened, 'PR')}, ${one.prsMerged} merged`,
    ...(one.workedMs > 0 ? [durationText(one.workedMs)] : []),
    outcomesText(one.outcomes)
  ].filter(Boolean)
  const last = one.recent.at(-1)
  const lastText = last
    ? `\n  last: ${last.ticket ?? '?'} ${last.outcome}${last.pr ? ` ${last.pr}` : ''}`
    : ''
  return `${head}\n  ${totals.join(' · ')}${lastText}`
}

export function formatGameCharacters(result: GameCharactersResult): string {
  return result.characters.length === 0
    ? 'No characters have worked here yet.'
    : result.characters.map(characterText).join('\n')
}

export const ORCHESTRATOR_GAME_CHARACTERS_HANDLERS: Record<string, CommandHandler> = {
  'game characters': async ({ client, json }) => {
    try {
      const response = await client.call<GameCharactersResult>('game.characters', {
        worktreeId: process.env.ORCA_WORKTREE_ID,
        terminalHandle: process.env.ORCA_TERMINAL_HANDLE
      })
      printResult(response, json, formatGameCharacters)
    } catch (error) {
      if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
        throw new RuntimeClientError(
          'incompatible_runtime',
          'The connected Orca Lab does not keep game characters yet. Update or restart Orca Lab.'
        )
      }
      throw error
    }
  }
}
