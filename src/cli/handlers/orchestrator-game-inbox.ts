import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { callGameBoard, gameBoardCaller, optionalText } from './orchestrator-game-board-call'
import type { GameInbox } from '../../shared/orchestrator-game-inbox'

export type GameInboxResult = { inbox: GameInbox }

export function formatGameInbox({ inbox }: GameInboxResult): string {
  const head = `${inbox.key} inbox: ${inbox.unread} unread`
  if (inbox.messages.length === 0) {
    return `${head}, no messages.`
  }
  return [
    head,
    ...inbox.messages.map(
      (one) =>
        `${one.unread ? '*' : ' '} ${one.at} ${one.from} ${one.type}: ${(one.body || one.subject).replace(/\s+/g, ' ')}`
    )
  ].join('\n')
}

export const ORCHESTRATOR_GAME_INBOX_HANDLERS: Record<string, CommandHandler> = {
  'game inbox': async ({ flags, client, json }) => {
    const ticket = optionalText(flags, 'ticket')?.toUpperCase()
    const response = await callGameBoard<GameInboxResult>(
      client,
      'game.inbox',
      {
        ...gameBoardCaller(),
        ...(ticket ? { ticket } : {}),
        ...(flags.get('unread') === true ? { unread: true } : {}),
        ...(flags.get('mark-read') === true ? { markRead: true } : {})
      },
      'inbox'
    )
    printResult(response, json, formatGameInbox)
  }
}
