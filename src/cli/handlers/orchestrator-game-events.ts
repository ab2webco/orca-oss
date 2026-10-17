import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  callGameBoard,
  gameBoardCaller,
  optionalText,
  sinceOf
} from './orchestrator-game-board-call'
import {
  GAME_EVENT_KINDS,
  GAME_EVENT_TEXT_MAX,
  isGameEventKind,
  type GameEvent
} from '../../shared/orchestrator-game-events'

export type GameEventsResult = { events: GameEvent[] }

export function formatGameEvents(result: GameEventsResult): string {
  if (result.events.length === 0) {
    return 'No game events yet.'
  }
  return result.events
    .map(
      (one) =>
        `${one.at} ${one.ticket ?? '-'} ${one.kind}${one.by ? ` by ${one.by}` : ''}${one.text ? `: ${one.text.replace(/\s+/g, ' ')}` : ''}`
    )
    .join('\n')
}

export const ORCHESTRATOR_GAME_EVENT_HANDLERS: Record<string, CommandHandler> = {
  'game events': async ({ flags, client, json }) => {
    const ticket = optionalText(flags, 'ticket')?.toUpperCase()
    const since = sinceOf(flags)
    const response = await callGameBoard<GameEventsResult>(
      client,
      'game.events',
      { ...gameBoardCaller(), ...(ticket ? { ticket } : {}), ...(since ? { since } : {}) },
      'events'
    )
    printResult(response, json, formatGameEvents)
  },
  'game event': async ({ flags, client, json }) => {
    const kind = optionalText(flags, 'kind')
    if (!isGameEventKind(kind)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Name the event kind: ${GAME_EVENT_KINDS.join(', ')}.`
      )
    }
    const text = optionalText(flags, 'text')
    if (text !== undefined && text.length > GAME_EVENT_TEXT_MAX) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--text must be at most ${GAME_EVENT_TEXT_MAX} characters.`
      )
    }
    const ticket = optionalText(flags, 'ticket')?.toUpperCase()
    const response = await callGameBoard<{ posted: boolean; event: GameEvent }>(
      client,
      'game.eventPost',
      { ...gameBoardCaller(), kind, ...(ticket ? { ticket } : {}), ...(text ? { text } : {}) },
      'events'
    )
    printResult(response, json, (result) =>
      result.posted ? `Posted ${formatGameEvents({ events: [result.event] })}` : 'Already posted.'
    )
  }
}
